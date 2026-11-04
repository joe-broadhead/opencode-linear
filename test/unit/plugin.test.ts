import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { ENDPOINTS, NAMESPACE_DESCRIPTION } from "../../src/constants.js"
import linear from "../../src/index.js"
import { createLinearPlugin, displayUrl, registerServer, serverConfig } from "../../src/plugin.js"
import type { ServerSource } from "../../src/status.js"
import { agentEditor, builtInAgents, mcpEditor, transforms, type McpEditor } from "./fake.js"

const skillsDir = mkdtempSync(join(tmpdir(), "linear-skills-"))
afterAll(() => rmSync(skillsDir, { recursive: true, force: true }))
for (const name of ["linear", "linear-write"]) {
  mkdirSync(join(skillsDir, name))
  writeFileSync(join(skillsDir, name, "SKILL.md"), `---\nname: ${name}\ndescription: Use Linear.\n---\nBody.\n`)
}
const seam = { endpoints: ENDPOINTS, skillsDir }

async function register(initial: Parameters<typeof mcpEditor>[0] = {}, access: "read" | "write" = "read") {
  const { transform, run } = transforms<McpEditor>()
  const records: [ServerSource | undefined, string | undefined][] = []
  await registerServer({ transform }, serverConfig(seam, access), (source, problem) => records.push([source, problem]))
  const { editor, servers } = mcpEditor(initial)
  run(editor)
  return { servers, records }
}

describe("the linear server", () => {
  test("is Linear's read-only server with the read scope, or the full server with both scopes for write access", () => {
    expect(serverConfig(seam, "read")).toEqual({ type: "remote", url: "https://mcp.linear.app/mcp/readonly", oauth: { scope: "read" } })
    expect(serverConfig(seam, "write")).toEqual({ type: "remote", url: "https://mcp.linear.app/mcp", oauth: { scope: "read write" } })
    const loopback = { read: "http://127.0.0.1:1/mcp/readonly", write: "http://127.0.0.1:1/mcp" }
    expect(serverConfig({ endpoints: loopback, oauth: false }, "write")).toEqual({ type: "remote", url: "http://127.0.0.1:1/mcp", oauth: false })
  })

  test("is registered under the stable name when the user has none", async () => {
    const { servers, records } = await register({ github: { type: "remote", url: "https://example.com/mcp" } })
    expect(servers.get("linear")).toEqual(serverConfig(seam, "read"))
    expect(servers.get("github")).toEqual({ type: "remote", url: "https://example.com/mcp" })
    expect(records).toEqual([[{ type: "plugin", url: "https://mcp.linear.app/mcp/readonly" }, undefined]])
  })

  test("adopts the user's own server for the access's URL, unchanged", async () => {
    const own = { type: "remote" as const, url: "https://mcp.linear.app/mcp/readonly/", oauth: { client_id: "pre-registered", callback_port: 19876 }, timeout: { execution: 60_000 } }
    const { servers, records } = await register({ linear: own })
    expect(servers.get("linear")).toEqual(own)
    expect(records).toEqual([[{ type: "adopted", url: "https://mcp.linear.app/mcp/readonly" }, undefined]])
    const write = await register({ linear: { type: "remote", url: "https://mcp.linear.app/mcp" } }, "write")
    expect(write.records).toEqual([[{ type: "adopted", url: "https://mcp.linear.app/mcp" }, undefined]])
  })

  test("Linear's full server is a conflict in read access, so read access stays read-only", async () => {
    const full = { type: "remote" as const, url: "https://mcp.linear.app/mcp" }
    const { servers, records } = await register({ linear: full })
    expect(servers.get("linear")).toEqual(full)
    expect(records).toEqual([[{ type: "conflict", url: "https://mcp.linear.app/mcp", expected: "https://mcp.linear.app/mcp/readonly" }, undefined]])
  })

  test("reports a server that points elsewhere as a conflict and adds nothing", async () => {
    const foreign = { type: "remote" as const, url: "https://linear.example.com/mcp?token=secret" }
    const { servers, records } = await register({ linear: foreign })
    expect([...servers]).toEqual([["linear", foreign]])
    expect(records).toEqual([[{ type: "conflict", url: "https://linear.example.com/mcp", expected: "https://mcp.linear.app/mcp/readonly" }, undefined]])
    const local = await register({ linear: { type: "local", command: ["linear-mcp"] } })
    expect(local.records).toEqual([[{ type: "conflict", url: "a local command", expected: "https://mcp.linear.app/mcp/readonly" }, undefined]])
  })

  test("never throws from the transform", async () => {
    const { transform, run } = transforms<McpEditor>()
    const records: [ServerSource | undefined, string | undefined][] = []
    await registerServer({ transform }, serverConfig(seam, "read"), (source, problem) => records.push([source, problem]))
    const { editor } = mcpEditor()
    expect(() => run({ ...editor, get: () => { throw new Error("broken editor") } })).not.toThrow()
    expect(records).toEqual([[undefined, "SERVER_NOT_REGISTERED: The linear MCP server could not be registered (broken editor). Next step: Restart OpenCode."]])
  })

  test("display URLs drop credentials, queries and trailing slashes", () => {
    expect(displayUrl("https://user:pass@mcp.linear.app/mcp/?key=1#x")).toBe("https://mcp.linear.app/mcp")
    expect(displayUrl("not a url")).toBe("an invalid URL")
  })
})

type SetupContext = Pick<Plugin.Context, "app" | "options" | "mcp" | "agent" | "skill" | "command" | "session" | "tool" | "integration" | "rpc" | "permission" | "location" | "event">

/** A context with only what setup touches. Each transform is collected so the test can replay it. */
function context(options: unknown, version = "2.2.3") {
  const mcp = transforms<McpEditor>()
  const agent = transforms<Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]>()
  const skill = transforms<Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]>()
  const command = transforms<Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]>()
  const tool = transforms<Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]>()
  const rpc: string[] = []
  const handlers = new Map<string, Record<string, (input: unknown, context: unknown) => Promise<unknown>>>()
  const hooks: string[] = []
  const ctx = {
    app: { name: "opencode", version, channel: "latest" },
    options: options as Plugin.Context["options"],
    mcp: { transform: mcp.transform, list: async () => ({ data: [{ name: "linear", status: { status: "connected" } }] }) },
    skill: { transform: skill.transform },
    command: { transform: command.transform },
    rpc: {
      register: async (definition: { id: string }, methods: Record<string, (input: unknown, context: unknown) => Promise<unknown>>) => {
        rpc.push(definition.id)
        handlers.set(definition.id, methods)
        return { dispose: async () => void rpc.splice(rpc.indexOf(definition.id), 1) }
      },
    },
    // A session whose agent allows everything, and one Linear read that answers "ok".
    session: { get: async () => ({ id: "ses_test", agent: "build", location: { directory: "/projects/linear-test" }, permissions: [] }) },
    agent: { transform: agent.transform, get: async () => ({ data: { id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] } }) },
    tool: { transform: tool.transform, list: async () => [{ id: "linear_list_issues", execute: async () => ({ content: [{ type: "text", text: "ok" }] }) }] },
    location: { directory: "/projects/linear-test" },
    permission: { hook: async (name: string) => (hooks.push(name), { dispose: async () => void hooks.splice(hooks.indexOf(name), 1) }) },
    event: { subscribe: ({ signal }: { signal: AbortSignal }) => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))) }) }) },
  } as unknown as SetupContext
  return { ctx: ctx as Plugin.Context, mcp, agent, skill, command, tool, rpc, handlers, hooks }
}

describe("setup", () => {
  test("the package default export is the plugin with its stable ID", () => {
    expect(linear.id).toBe("linear.workspace")
    expect(typeof linear.setup).toBe("function")
  })

  test.each([
    ["read", ["linear"]],
    ["write", ["linear", "linear-write"]],
  ] as const)("%s access registers the server, the rules, the skills %j, the status command, its RPC and the tools RPC", async (access, expected) => {
    const { ctx, mcp, agent, skill, command, tool, rpc, hooks } = context({ access })
    const cleanup = await createLinearPlugin(seam).setup(ctx)
    const { editor, servers } = mcpEditor()
    mcp.run(editor)
    expect(servers.get("linear")).toEqual(serverConfig(seam, access))
    const agents = builtInAgents()
    agent.run(agentEditor(agents))
    expect(agents.every((item) => item.permissions[1]?.action === "linear_*")).toBe(true)
    const skills: string[] = []
    skill.run({ add: (info: { id: string }) => skills.push(info.id) } as never)
    expect(skills).toEqual([...expected])
    const commands: string[] = []
    command.run({ add: (definition: { name: string }) => commands.push(definition.name) })
    expect(commands).toEqual(["linear-status"])
    // Code Mode's catalog describes the linear namespace, with what the access allows.
    const namespaces: { name: string; description?: string }[] = []
    tool.run({ namespace: (namespace: { name: string; description?: string }) => void namespaces.push(namespace) } as never)
    expect(namespaces).toEqual([{ name: "linear", description: NAMESPACE_DESCRIPTION[access] }])
    expect(rpc).toEqual(["linear.workspace", "linear.workspace.tools"])
    // The tools RPC's one hook: it refuses an ask on its own script calls.
    expect(hooks).toEqual(["evaluate"])
    expect(typeof cleanup).toBe("function")
    await cleanup!()
    expect(rpc).toEqual(["linear.workspace"])
    expect(hooks).toEqual([])
  })

  test.each([
    ["registers its own server", {}, { value: { text: "ok" } }],
    ["adopts the user's server at the access's URL", { linear: { type: "remote", url: ENDPOINTS.read } }, { value: { text: "ok" } }],
    ["finds a user server at another URL", { linear: { type: "remote", url: ENDPOINTS.write } }, { code: "SERVER_CONFLICT" }],
  ] as const)("the tools RPC runs a read when the plugin %s, or refuses with its code", async (_, initial, expected) => {
    const { ctx, mcp, handlers } = context({})
    const cleanup = await createLinearPlugin(seam).setup(ctx)
    mcp.run(mcpEditor(initial as Parameters<typeof mcpEditor>[0]).editor)
    const rpcContext = { signal: new AbortController().signal, error: (_type: string, _message: string, data: { code: string }) => ({ code: data.code }) }
    const result = await handlers.get("linear.workspace.tools")!.list_issues!({ sessionID: "ses_test", input: {} }, rpcContext)
    expect("code" in (result as object) ? result : { value: result }).toEqual(expected)
    await cleanup!()
  })

  test("refuses invalid options and untested hosts before registering anything", async () => {
    const invalid = context({ access: "admin" })
    await expect(createLinearPlugin(seam).setup(invalid.ctx)).rejects.toThrow("OPTIONS_INVALID")
    const untested = context({}, "0.0.0-dev-1")
    await expect(createLinearPlugin(seam).setup(untested.ctx)).rejects.toThrow("HOST_UNTESTED")
    for (const item of [invalid, untested]) expect([item.mcp, item.agent, item.skill, item.command, item.tool].map((t) => t.callbacks.length)).toEqual([0, 0, 0, 0, 0])
    for (const item of [invalid, untested]) expect([item.rpc, item.hooks]).toEqual([[], []])
  })

  test("a host outside the range runs with the override, and an untested release inside the range runs without it", async () => {
    for (const [options, version] of [[{ allowUntestedHost: true }, "2.3.0"], [{}, "2.2.6"]] as const) {
      const { ctx, mcp } = context(options, version)
      const cleanup = await createLinearPlugin(seam).setup(ctx)
      expect(mcp.callbacks).toHaveLength(1)
      await cleanup!()
    }
  })
})
