/**
 * `createToolRead` against the real OpenCode 2.4.1 host: the host connects to a loopback MCP server, the probe
 * plugin lends its context, and the provider's read finds the server's tool, executes it through the host and parses
 * what comes back. The error paths are real too: a server the host does not list is `NEEDS_SIGN_IN`, and a tool that
 * answers with an upstream error rejects.
 *
 * The host always gives an MCP tool call an `output` (a string, an object or null), so `createToolRead`'s branch for a
 * content-only answer that is not JSON cannot be reached through this host; `test/tool-read.test.ts` covers that branch
 * with a `ToolSource`, and this file covers the host executor it really runs behind.
 *
 * The plugin's own MCP server points at Linear and needs a sign-in, so this test configures a second remote server in
 * the host's `mcp.servers` and reads it through the same `createToolRead` the handlers use. The environment is moved
 * into a fresh temp root before `@opencode/sdk` loads.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { createToolRead, type ToolCall } from "../../src/provider/client.ts"
import { startFakeMcp } from "../support/fake-mcp.ts"

const root = mkdtempSync(join(tmpdir(), "linear-tool-read-"))
const home = join(root, "home")
const config = join(root, "config")
const work = join(root, "work")
for (const directory of [home, config, work]) mkdirSync(directory, { recursive: true })
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  TMPDIR: join(root, "tmp"),
})
mkdirSync(join(root, "tmp"), { recursive: true })

const contractError = (code: string) => (error: unknown) => error instanceof SourceError && error.code === code

test("createToolRead reads through the real 2.4.1 host and refuses a missing server and an upstream error", { timeout: 120_000 }, async (t) => {
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const fake = await startFakeMcp()
  t.after(() => fake.close())

  const { OpenCode } = await import("@opencode/sdk")
  const { Plugin: PluginRuntime } = await import("@opencode/plugin")
  const probes = new Map<string, Plugin.Context>()
  const probe = PluginRuntime.define({ id: "linear.tool-read.probe", setup: (ctx) => void probes.set(ctx.location.directory, ctx) })
  const host = await OpenCode.create({
    plugins: [probe],
    app: { name: "opencode", version: "2.4.1" },
    config: {
      content: JSON.stringify({ mcp: { servers: { "linear-test": { type: "remote", url: fake.url, oauth: false } } } }),
      directory: config,
      project: false,
    },
    database: { path: join(root, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error", emit: () => undefined },
  })
  const location = { directory: work }
  try {
    const session = await host.sessions.create({ location, agent: "build", permissions: [] } as never)
    await host.sessions.prompt({ sessionID: session.id, text: "activate the probe", delivery: "queue" } as never).catch(() => undefined)

    const deadline = Date.now() + 60_000
    let ctx: Plugin.Context | undefined
    for (;;) {
      ctx = probes.get(work)
      const tools = ctx === undefined ? [] : await ctx.tool.list()
      if (tools.some((tool) => tool.id === "linear-test_echo")) break
      assert.ok(Date.now() < deadline, "the host did not list the fake MCP server's tools within 60 s")
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(ctx !== undefined)

    const read = createToolRead({ plugin: "linear", tools: ctx.tool })
    const call: ToolCall = {
      sessionID: session.id,
      agent: "build",
      messageID: "msg_tool_read",
      id: "call_tool_read",
      signal: new AbortController().signal,
      progress: async () => undefined,
    }

    // The answer: the host's own executor ran linear-test_echo and its structured content came back unchanged.
    assert.deepEqual(await read("test", "echo", { message: "hello" }, call), { tool: "echo", arguments: { message: "hello" } })
    assert.deepEqual(fake.calls, ["echo"])

    // Error path 1: a server the host does not list.
    await assert.rejects(() => read("absent", "echo", {}, call), contractError("NEEDS_SIGN_IN"))

    // Error path 2: the tool ran and answered with an upstream error, which the host rejects.
    await assert.rejects(() => read("test", "fail", {}, call), (error: unknown) => error instanceof Error)
    assert.deepEqual(fake.calls, ["echo", "fail"])
  } finally {
    await host.close()
  }
})
