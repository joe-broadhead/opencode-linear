import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { ENDPOINTS } from "../../src/constants.js"
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

type SetupContext = Pick<Plugin.Context, "app" | "options" | "mcp" | "agent" | "skill" | "command" | "session" | "tool" | "integration" | "rpc" | "event">

/** A context with only what setup touches. Each transform is collected so the test can replay it. */
function context(options: unknown, version = "2.2.3") {
  const mcp = transforms<McpEditor>()
  const agent = transforms<Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]>()
  const skill = transforms<Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]>()
  const command = transforms<Parameters<Parameters<Plugin.Context["command"]["transform"]>[0]>[0]>()
  const tool = transforms<Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]>()
  const rpc: string[] = []
  const ctx = {
    app: { name: "opencode", version, channel: "latest" },
    options: options as Plugin.Context["options"],
    mcp: { transform: mcp.transform, list: async () => ({ data: [] }) },
    agent: { transform: agent.transform },
    skill: { transform: skill.transform },
    command: { transform: command.transform },
    tool: { transform: tool.transform, list: async () => [] },
    rpc: { register: async (definition: { id: string }) => (rpc.push(definition.id), { dispose: async () => {} }) },
    event: { subscribe: ({ signal }: { signal: AbortSignal }) => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))) }) }) },
  } as unknown as SetupContext
  return { ctx: ctx as Plugin.Context, mcp, agent, skill, command, tool, rpc }
}

describe("setup", () => {
  test("the package default export is the plugin with its stable ID", () => {
    expect(linear.id).toBe("linear.workspace")
    expect(typeof linear.setup).toBe("function")
  })

  test.each([
    ["read", ["linear"]],
    ["write", ["linear", "linear-write"]],
  ] as const)("%s access registers the server, the rules, the skills %j, the status command and its RPC", async (access, expected) => {
    const { ctx, mcp, agent, skill, command, tool, rpc } = context({ access })
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
    const tools: string[] = []
    tool.run({ add: (info: { name: string }) => tools.push(info.name) } as never)
    expect(tools).toEqual(["issues"])
    expect(rpc).toEqual(["linear.workspace"])
    expect(typeof cleanup).toBe("function")
    await cleanup!()
  })

  test("refuses invalid options and untested hosts before registering anything", async () => {
    const invalid = context({ access: "admin" })
    await expect(createLinearPlugin(seam).setup(invalid.ctx)).rejects.toThrow("OPTIONS_INVALID")
    const untested = context({}, "0.0.0-dev-1")
    await expect(createLinearPlugin(seam).setup(untested.ctx)).rejects.toThrow("HOST_UNTESTED")
    for (const item of [invalid, untested]) expect([item.mcp, item.agent, item.skill, item.command, item.tool].map((t) => t.callbacks.length)).toEqual([0, 0, 0, 0, 0])
    for (const item of [invalid, untested]) expect(item.rpc).toEqual([])
  })

  test("an untested host runs with the override", async () => {
    const { ctx, mcp } = context({ allowUntestedHost: true }, "2.3.0")
    const cleanup = await createLinearPlugin(seam).setup(ctx)
    expect(mcp.callbacks).toHaveLength(1)
    await cleanup!()
  })
})
