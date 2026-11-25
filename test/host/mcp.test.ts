/**
 * The real OpenCode 2.4.1 host registers the plugin's Linear MCP server for every account.
 *
 * The contract's `createHost` records tools, RPC, agents and asks, but not MCP servers, so this test builds the same
 * embedded host the kit builds (`@we-the-rebel-alliance/plugin-contract` `dist/internal/host/createHost`: one
 * `OpenCode.create`, a session, one queued prompt, then `waitForActivation`) and reads the host client's own
 * `mcp.list` (`@opencode/client/dist/promise/client.d.ts:333`). The plugin loaded is the committed `dist/index.js`,
 * the file an install runs, so a server that is not registered with the host fails this test.
 *
 * The project is empty and every host directory is in a fresh temp root, before `@opencode/sdk` loads: HOME, the XDG
 * folders, the config directory, the project directory and the database. The one fetch the host makes for the
 * plugin's server is answered here with 401 and recorded, so the test proves the address is Linear's MCP endpoint
 * without a token and without the network. The host may show `needs_auth` or `pending`; the assertion is that the
 * server is registered, not that it is connected.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { after, test } from "node:test"
import type { Plugin } from "@opencode/plugin"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
/** Linear's MCP endpoint, the address every account's server must have. */
const MCP_URL = "https://mcp.linear.app/mcp"

const root = mkdtempSync(join(tmpdir(), "linear-mcp-host-"))
const home = join(root, "home")
const config = join(root, "config")
for (const directory of [home, config]) mkdirSync(directory, { recursive: true })
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
after(() => rmSync(root, { recursive: true, force: true }))

/** Every request the host made to Linear's MCP endpoint, in order. */
const attempts: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname === "mcp.linear.app") {
    attempts.push(`${init?.method ?? "GET"} ${url.href}`)
    // A signed-out host: the server is registered, and the sign-in is what remains.
    return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json" } })
  }
  return realFetch(input, init)
}) as typeof fetch

/** The built entry, as `dist/index.js` exports it. */
interface PluginModule {
  readonly default: Plugin.Plugin
}
/** The parts of the host answers this test reads; the SDK's own promises resolve to `any`. */
interface HostEntry {
  readonly id: string
  readonly state?: { readonly status?: string; readonly error?: string }
}
interface HostServer {
  readonly name: string
  readonly status: { readonly status: string; readonly error?: string }
}
type Host = Awaited<ReturnType<typeof createHost>>

let hosts = 0

/** One host, one empty project, one plugin: activated before it is returned. */
async function createHost(options: Readonly<Record<string, unknown>> = {}) {
  const base = join(root, `host-${++hosts}`)
  const work = join(base, "work")
  mkdirSync(work, { recursive: true })
  const { OpenCode } = await import("@opencode/sdk")
  const { Plugin: PluginRuntime } = await import("@opencode/plugin")
  const loaded = (await import(pathToFileURL(join(ROOT, "dist", "index.js")).href)) as PluginModule
  const plugin = loaded.default
  assert.equal(plugin.id, "linear")
  // The host passes a plugin's own `options` in its context; this wraps the built entry with the options under test.
  const withOptions = PluginRuntime.define({ id: plugin.id, setup: (context) => plugin.setup({ ...context, options }) })
  const client = await OpenCode.create({
    plugins: [withOptions],
    app: { name: "opencode", version: "2.4.1" },
    config: { content: "{}", directory: config, project: false },
    database: { path: join(base, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error", emit: () => undefined },
  })
  const location = { directory: work }
  const deadline = Date.now() + 60_000
  try {
    const session = await client.sessions.create({ location, agent: "build", permissions: [] })
    await client.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" }).catch(() => undefined)
    for (;;) {
      const { data } = (await client.plugin.list({ location })) as { readonly data: readonly HostEntry[] }
      const state = data.find((entry: HostEntry) => entry.id === "linear")?.state
      if (state?.status === "active") break
      assert.notEqual(state?.status, "failed", `the plugin failed to start: ${JSON.stringify(state)}`)
      assert.ok(Date.now() < deadline, "the plugin did not activate within 60 s")
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return { client, location, work }
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

/** The host reconciles plugin-registered servers asynchronously; wait for the names the test expects. */
async function servers(host: Host, names: readonly string[]): Promise<readonly HostServer[]> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const { data } = (await host.client.mcp.list({ location: host.location })) as { readonly data: readonly HostServer[] }
    if (names.every((name) => data.some((server: HostServer) => server.name === name))) return data
    assert.ok(Date.now() < deadline, `the host lists ${data.map((server: HostServer) => server.name).join(", ") || "no MCP servers"}; expected ${names.join(", ")}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Wait until the host has tried Linear once per expected server, then 401 every attempt was ours. */
async function linearAttempts(count: number): Promise<readonly string[]> {
  const deadline = Date.now() + 60_000
  while (attempts.length < count) {
    assert.ok(Date.now() < deadline, `the host made ${attempts.length} request(s) to Linear's MCP endpoint; expected ${count}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return attempts
}

test("the default account registers one Linear MCP server at Linear's URL on the real 2.4.1 host", { timeout: 120_000 }, async () => {
  attempts.length = 0
  const host = await createHost()
  try {
    const data = await servers(host, ["linear"])
    const linear = data.find((server) => server.name === "linear")
    assert.ok(linear, "the default account's server is not registered")
    assert.ok(["needs_auth", "pending"].includes(linear.status.status), `the server is ${linear.status.status}: ${linear.status.error ?? ""}`)
    assert.equal(data.filter((server) => server.name.startsWith("linear-")).length, 0, "the default account registered an alias server")

    const made = await linearAttempts(1)
    assert.deepEqual([...new Set(made.map((entry) => entry.replace(/^[A-Z]+ /, "").split("?")[0]))], [MCP_URL])
    assert.ok(made.every((entry) => entry.startsWith("POST ")), `the host did not connect to Linear's server: ${made.join(", ")}`)
  } finally {
    await host.client.close()
  }
})

test("two accounts register linear-work and linear-personal, each at Linear's URL, on the real 2.4.1 host", { timeout: 120_000 }, async () => {
  attempts.length = 0
  const host = await createHost({ accounts: { work: {}, personal: {} } })
  try {
    const data = await servers(host, ["linear-work", "linear-personal"])
    for (const name of ["linear-work", "linear-personal"]) {
      const server = data.find((entry) => entry.name === name)
      assert.ok(server, `${name} is not registered`)
      assert.ok(["needs_auth", "pending"].includes(server.status.status), `${name} is ${server.status.status}: ${server.status.error ?? ""}`)
    }
    assert.equal(data.some((server) => server.name === "linear"), false, "the default server was registered next to the aliases")

    const made = await linearAttempts(2)
    assert.deepEqual([...new Set(made.map((entry) => entry.replace(/^[A-Z]+ /, "").split("?")[0]))], [MCP_URL])
    assert.ok(made.every((entry) => entry.startsWith("POST ")), `the host did not connect to Linear's server: ${made.join(", ")}`)
  } finally {
    await host.client.close()
  }
})
