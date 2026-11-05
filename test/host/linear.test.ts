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
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { ASSIGNED } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, effect, HOST_VERSION, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /linear-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Linear tools."

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
    return ids.length === 4 && ids.sort()
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
    expect(await linearTools(host)).toEqual(["linear_issues", "linear_list_issues", "linear_save_issue", "linear_shiny_new_tool"])
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

  test("linear_issues runs through the host's own list_issues: its rules, Linear's live shape and the fields it shows", async () => {
    await linearTools(host)
    const issues = (await host.probe().tool.list()).find((tool) => tool.id === "linear_issues")!
    const run = async (sessionID: string) => {
      const context = { sessionID, agent: "build", messageID: "msg_host_test", id: `call_issues_${sessionID}`, signal: new AbortController().signal, progress: async () => {} }
      return issues.execute({ limit: 2 }, context as never)
    }
    const from = host.fake.inputs.length
    const result = (await run(await session(host))) as { output: { rows: unknown[] }; content: unknown }
    expect(host.fake.inputs.slice(from)).toEqual([{ tool: "list_issues", arguments: { assignee: "me", limit: 2, fields: ["id", "title", "status", "priority", "url"] } }])
    expect(result.output.rows).toEqual(ASSIGNED.issues.map((item) => ({ identifier: item.id, title: item.title, state: item.status, priority: item.priority.name, url: item.url })))
    expect(JSON.stringify(result.content)).toContain("Linear has more assigned issues than these 2")
    // A session that denies list_issues alone: linear_issues itself may run, but its nested call is refused.
    const permissions = [{ action: "linear_list_issues", resource: "*", effect: "deny" as const }]
    const locked = (await host.client.sessions.create({ agent: "build", location: host.location, permissions })).id
    const before = host.fake.inputs.length
    await expect(run(locked)).rejects.toThrow("Permission denied: linear_list_issues")
    expect(host.fake.inputs.length).toBe(before)
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
    expect(text).toContain("- Tools: 4 available, 1 unknown: shiny_new_tool (unknown tools ask before running)\n")
    expect(text).toContain(`- Agents without default rules: reviewer\n${AGENT_RULES}\n`)
    expect(text).toContain(`- Next step: ${AGENTS_NEXT_STEP}`)
    expect(text).toContain(`- OpenCode: ${HOST_VERSION} (${TESTED_HOSTS.includes(HOST_VERSION) ? "tested" : "untested"}; supported range ${SUPPORTED_HOST})`)
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

// The /connect mark is only observable while a credential remains, so this signs in with Linear's own flow and a token
// that has no refresh token: a 401 then needs a new sign-in rather than a refresh, and the account stays. The plugin
// reads its mark back from the projected connection, so the mark it sets is the one it clears.
describe("the /connect sign-in mark", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, challenge: true, fake: { refreshTokens: false } })
  })
  afterAll(() => host?.close())

  const SIGN_IN_AGAIN = "Linear needs a new sign-in. Choose this account to sign in again."

  /** The /connect entry's connections, with the status a credential shows there. */
  const connections = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "linear")?.integrationID
    if (!integrationID) return []
    const { data } = await host.client.integration.get({ integrationID, location: host.location })
    return (data as unknown as { connections?: { type?: string; status?: { status: string; message?: string } }[] }).connections ?? []
  }

  /** Signs in through OpenCode's own flow: the authorization endpoint redirects the loopback callback, which exchanges its code. */
  const signIn = async () => {
    const { data: servers } = await host.client.mcp.list({ location: host.location })
    const integrationID = servers.find((server) => server.name === "linear")!.integrationID!
    const { data: integration } = await host.client.integration.get({ integrationID, location: host.location })
    const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
    const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration.methods[0] as unknown as { id: string }).id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    const callback = redirect.headers.get("location")
    expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    await fetch(callback!)
  }
  const connected = () =>
    until("the server is connected", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "linear")?.status.status === "connected"
    })

  test("is set while the server needs a sign-in, and cleared once the same account connects again", async () => {
    await signIn()
    await until("the sign-in stores a token without a refresh token", async () => host.fake.tokens.length === 1)
    expect(host.fake.tokens[0]).toMatchObject({ grant_type: "authorization_code" })
    expect(host.fake.tokens[0]).not.toHaveProperty("refresh_token")
    host.fake.challenge = false
    await connected()
    expect(await until("/connect shows the account", async () => (await connections()).find((item) => item.type === "credential" && item.status?.message === undefined))).toBeDefined()

    // The token stops working, and there is no refresh token: a new sign-in, with the credential kept.
    host.fake.challenge = true
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.disconnect({ server: "linear", location: host.location })
    await mcp.connect({ server: "linear", location: host.location }).catch(() => {})
    await until("the server needs a sign-in", async () => {
      const { data } = await host.client.mcp.list({ location: host.location })
      return data.find((server) => server.name === "linear")?.status.status === "needs_auth"
    })
    expect(await until("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_AGAIN))).toBeDefined()

    // The same account connects again: the plugin clears its own mark.
    host.fake.challenge = false
    await mcp.connect({ server: "linear", location: host.location })
    await connected()
    expect(await until("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })
})
