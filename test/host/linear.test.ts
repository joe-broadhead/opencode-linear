// The plugin on the public @opencode/sdk host: H1 load and connect, H2 visibility per access mode, H3 the
// permission model (P1-P5), H4 adoption and conflict, H5 /linear-status, H6 unload, and the /connect entry. Each
// describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { AGENTS_FIX } from "../../src/status.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const allow = (tool: string): Rule => ({ action: `linear_${tool}`, resource: "*", effect: "allow" })
const deny = (tool: string): Rule => ({ action: `linear_${tool}`, resource: "*", effect: "deny" })
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
/** The host hides a tool when the last rule matching its action is a deny on every resource. */
const hidden = (rules: readonly Rule[], action: string) => {
  const last = rules.findLast((rule) => wildcard(rule.action).test(action))
  return last?.resource === "*" && last.effect === "deny"
}

/** The host lists an MCP server's tools shortly after it connects. */
const linearTools = (host: Host) =>
  until("Linear's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith("linear_"))
    return ids.length === 3 && ids.sort()
  })

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "linear-status", text: "" })
  return until("/linear-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

describe(`read access on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { reviewer: { description: "Reviews changes", mode: "subagent" } } }) })
  })
  afterAll(() => host?.close())

  test("the host's global folders, temp folder and working directory are inside the test's temp root", async () => {
    const global = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"].map((key) => join(process.env[key]!, "opencode"))
    expect(global.filter((path) => !existsSync(path))).toEqual([])
    const { paths } = await host.client.server.info()
    const used = [...global, realpathSync(paths.tmp), process.env.OPENCODE_TEST_HOME!, tmpdir(), process.cwd()]
    expect(used.filter((path) => !path.startsWith(ROOT + sep))).toEqual([])
  })

  test("H1: the plugin is active, linear is connected, and Linear's tools, skill and command are registered", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "linear.workspace")?.state.status).toBe("active")
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    expect(servers.find((server) => server.name === "linear")?.status).toEqual({ status: "connected" })
    expect(await linearTools(host)).toEqual(["linear_list_issues", "linear_save_issue", "linear_shiny_new_tool"])
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("linear"))).toEqual(["linear"])
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).toContain("linear-status")
  })

  test("P1: the rules sit right after the base allow in every built-in agent, once", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBe(0)
      expect(permissions.slice(base + 1, base + 1 + defaultRules().length)).toEqual(defaultRules())
      expect(permissions.filter((rule) => rule.action === "linear_*")).toHaveLength(1)
    }
  })

  test("P1: Plan and Explore are not weakened", async () => {
    expect(await effect(host, "plan", "edit")).toBe("deny")
    expect(await effect(host, "explore", "linear_list_issues")).toBe("deny")
    const explore = await session(host, "explore")
    expect(await attempt(host, explore, "explore", "list_issues")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: linear_list_issues" })
    const plan = await session(host, "plan")
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toMatchObject({ asked: "linear_shiny_new_tool", ok: false })
  })

  test("P2 and H2: known reads run without a prompt, and everything else asks", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "list_issues")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: "linear_shiny_new_tool", ok: false, error: "Permission.DeclinedError: " })
    expect(await attempt(host, build, "build", "save_issue")).toEqual({ asked: "linear_save_issue", ok: false, error: "Permission.DeclinedError: " })
    expect(host.fake.calls.slice(before)).toEqual(["list_issues"])
    const build_ = (await agentRules(host)).get("build")!
    expect(["linear_list_issues", "linear_save_issue", "linear_shiny_new_tool"].filter((action) => hidden(build_, action))).toEqual([])
    expect(await effect(host, "build", "linear_shiny_new_tool")).toBe("ask")
  })

  test("P4: a saved 'Always allow' removes the prompt", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "shiny_new_tool", "always")).toEqual({ asked: "linear_shiny_new_tool", ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: undefined, ok: true })
    const { projectID } = await host.client.sessions.get({ sessionID: build })
    const saved = await host.client.permission.saved.list({ projectID })
    expect(saved.map(({ action, resource }) => ({ action, resource }))).toEqual([{ action: "linear_shiny_new_tool", resource: "*" }])
  })

  test("P5: an agent defined only in user config gets no rules, and Linear tools run there unprompted", async () => {
    const reviewer = (await agentRules(host)).get("reviewer")!
    expect(reviewer.some((rule) => rule.action.startsWith("linear_"))).toBe(false)
    const sessionID = await session(host, "reviewer")
    expect(await attempt(host, sessionID, "reviewer", "save_issue")).toEqual({ asked: undefined, ok: true })
  })

  test("H5: /linear-status reports the connection, new tools, the unguarded agent and its fix", async () => {
    await linearTools(host)
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.endpoints.read}, registered by this plugin)`)
    expect(text).toContain("- Tools: 3 available, 1 unknown: shiny_new_tool (unknown tools ask before running)\n")
    expect(text).toContain("- Agents without default rules: reviewer.")
    expect(text).toContain(AGENTS_FIX)
    expect(text).toContain(`- Next step: Add the block above to each listed agent's own "permissions".`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (tested)`)
  })

  test("H6: unloading the plugin removes the server, the rules and the command", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: "linear.workspace", setup: () => {} }))
    await until("the linear server is gone", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return !data.some((server) => server.name === "linear")
    })
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect(rules.get(id)!.some((rule) => rule.action.startsWith("linear_"))).toBe(false)
    const { data: commands } = await host.client.command.list({ location: host.location })
    expect(commands.map((command) => command.name)).not.toContain("linear-status")
  })
})

describe("write access with the user's own linear server", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      options: { access: "write" },
      config: (url) => ({ mcp: { servers: { linear: { type: "remote", url, oauth: false, headers: { "x-linear-test": "user" } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: the user's server is adopted unchanged", async () => {
    await attempt(host, await session(host), "build", "list_issues")
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.endpoints.write}, your own mcp.servers.linear, used unchanged)`)
    expect(text).toContain("- Access: read and write (each change asks before it runs)")
  })

  test("P2 and H2: in write mode known writes ask, and the write skill is registered", async () => {
    const build = await session(host)
    expect(hidden((await agentRules(host)).get("build")!, "linear_save_issue")).toBe(false)
    expect(await attempt(host, build, "build", "save_issue")).toEqual({ asked: "linear_save_issue", ok: false, error: "Permission.DeclinedError: " })
    expect(await attempt(host, build, "build", "save_issue", "once")).toEqual({ asked: "linear_save_issue", ok: true })
    expect(await attempt(host, build, "build", "list_issues")).toEqual({ asked: undefined, ok: true })
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("linear")).sort()).toEqual(["linear", "linear-write"])
  })
})

describe("user permissions in read access", () => {
  const userRules = [allow("save_issue"), deny("list_issues")]
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: () => ({
        permissions: userRules,
        // The documented fix for a config-only agent: the plugin's block first, then the user's rules again.
        agents: { reviewer: { description: "Reviews changes", mode: "subagent", permissions: [...defaultRules(), ...userRules] } },
      }),
    })
  })
  afterAll(() => host?.close())

  test("P3: a user allow on a write removes the prompt, and a user deny on a read hides it", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "save_issue")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "list_issues")).toEqual({ asked: undefined, ok: false, error: "Tool.Error: Permission denied: linear_list_issues" })
    expect(hidden((await agentRules(host)).get("build")!, "linear_list_issues")).toBe(true)
    expect(await attempt(host, build, "build", "shiny_new_tool")).toMatchObject({ asked: "linear_shiny_new_tool", ok: false })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toMatchObject({ asked: "linear_shiny_new_tool", ok: false })
    expect(await attempt(host, reviewer, "reviewer", "save_issue")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, reviewer, "reviewer", "list_issues")).toMatchObject({ asked: undefined, ok: false })
    expect(await status(host, reviewer)).toContain("- Agents without default rules: none\n")
  })
})

describe("a user linear server that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { linear: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
  })
  afterAll(() => host?.close())

  test("H4: is left in place and reported as a conflict", async () => {
    const text = await status(host, await session(host))
    const other = host.fake.url.replace(/\/mcp$/, "/other")
    expect(text).toContain(`- Connection: conflict (your mcp.servers.linear points at ${other})`)
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.linear with ${other}, but access "read" uses ${host.fake.endpoints.read}.`)
  })
})

describe("the /connect entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true })
  })
  afterAll(() => host?.close())

  const entry = async () => {
    const { data } = await host.client.mcp.list({ location: host.location })
    const integrationID = data.find((server) => server.name === "linear")?.integrationID
    if (!integrationID) return undefined
    return (await host.client.integration.get({ integrationID, location: host.location })).data
  }

  test("is named Linear, also after the host reloads its MCP servers", async () => {
    expect((await until("the entry is named Linear", async () => ((await entry())?.name === "Linear" ? entry() : undefined)))?.methods).toHaveLength(1)
    await host.probe().mcp.reload()
    await until("the entry is named Linear again after the reload", async () => (await entry())?.name === "Linear")
    await Bun.sleep(1000)
    expect((await entry())?.name).toBe("Linear")
  })
})
