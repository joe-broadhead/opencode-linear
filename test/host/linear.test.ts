// The plugin on the public @opencode/sdk host: H1 load and connect, H2 visibility per access mode, H3 the
// permission model (P1-P5), H4 adoption and conflict, H5 /linear-status, H6 unload, and the /connect entry. Each
// describe owns one host.
import { ROOT } from "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { Plugin } from "@opencode/plugin"
import * as z from "zod"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { ASSIGNED } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, codeMode, effect, HOST_VERSION, ruledSession, script, session, startHost, until, type Host } from "./harness.js"

const AGENT_RULES = defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n")
const AGENTS_NEXT_STEP = "Put the default rules shown by /linear-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Linear tools."

// Starting a host takes several seconds, more on a busy machine.
setDefaultTimeout(120_000)
afterAll(cleanup)

test("the forced Linear catalogue stays under 1,000 tokens", async () => {
  let captured = ""
  const mock = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const body = await request.json() as { messages?: { role: string; content?: unknown }[] }
    const system = (body.messages ?? []).filter(item => item.role === "system").map(item => typeof item.content === "string" ? item.content : "").join("\n")
    if (system.includes("- linear (")) captured = system
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "m1", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(`${chunk({ role: "assistant", content: "ok" })}${chunk({}, "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
  } })
  let target: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    target = await startHost({ config: () => ({ providers: { scripted: { name: "Scripted", package: ["@opencode", "ai", "providers", "openai-compatible"].join("/"), settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "test" }, models: { m1: { name: "Mock", capabilities: { tools: true } } } } }, model: "scripted/m1" }) })
    await until("the Linear tools to register", async () => (await target!.probe().tool.list()).some(tool => tool.id === "linear_list_issues"))
    const filler = await target.probe().tool.transform(editor => {
      editor.namespace({ name: "filler", description: "Spends the inline budget." })
      editor.add({ name: "pad", description: "pad", input: z.object({ note: z.string().describe("x".repeat(9000)) }), options: { namespace: "filler", permission: "filler_pad", pinned: true }, execute: async () => ({ content: "ok" }) } as never)
    })
    try {
      const session = await target.client.session.create({ location: target.location, agent: "build" } as never)
      await target.client.session.prompt({ sessionID: session.id, text: "Reply with ok." } as never)
      await until("the catalogue", async () => captured.includes("- linear ("))
      const lines = captured.split("\n"), start = lines.findIndex(line => line.startsWith("- linear (")), section = [lines[start]!]
      for (let i = start + 1; i < lines.length && lines[i]!.startsWith("  "); i++) section.push(lines[i]!)
      expect(Math.round(section.join("\n").length / 4)).toBeLessThanOrEqual(1000)
    } finally { await filler.dispose() }
  } finally { await target?.close(); mock.stop(true) }
}, 120_000)

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
    return ids.length === 5 && ids.sort()
  })

async function status(host: Host, sessionID: string) {
  await host.client.sessions.command({ sessionID, name: "linear-status", text: "" })
  return until("/linear-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

describe(`the default access on OpenCode ${HOST_VERSION}`, () => {
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
    // The fake's three tools, and the plugin's own linear_issues and linear_events_list.
    expect(await linearTools(host)).toEqual(["linear_events_list", "linear_issues", "linear_list_issues", "linear_save_issue", "linear_shiny_new_tool"])
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("linear"))).toEqual(["linear", "linear-write"])
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
    // R18: the pattern allows a tool Linear adds later, so it runs there too.
    expect(await attempt(host, plan, "plan", "shiny_new_tool")).toEqual({ asked: undefined, ok: true })
  })

  // R18: every tool runs without a prompt at the default access, reads, writes and a tool Linear adds later alike.
  test("H2: every tool runs without a prompt, reads, writes and one the plugin does not know", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "list_issues")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "save_issue")).toEqual({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["list_issues", "shiny_new_tool", "save_issue"])
    const build_ = (await agentRules(host)).get("build")!
    expect(["linear_list_issues", "linear_save_issue", "linear_shiny_new_tool"].filter((action) => hidden(build_, action))).toEqual([])
    expect(await effect(host, "build", "linear_shiny_new_tool")).toBe("allow")
  })

  // R2: the same proofs on the Code Mode path, inside the host's `execute`, where nobody can answer a prompt.
  test("R2 Code Mode: a read and a write run; an ask and a deny are refused with nothing sent; an unknown name is not callable", async () => {
    await linearTools(host)
    const run = async (sessionID: string, tool: string) => codeMode(host, sessionID, `const r = await tools.linear[${JSON.stringify(tool)}]({}); throw new Error("SEEN " + JSON.stringify(r))`)
    const before = host.fake.calls.length
    expect(await run(await session(host), "list_issues")).toHaveProperty("seen")
    expect(await run(await session(host), "save_issue")).toHaveProperty("seen")
    expect(host.fake.calls.slice(before)).toEqual(["list_issues", "save_issue"])

    // An ask is refused before the tool runs: nothing reaches Linear and no prompt is left waiting.
    const asking = host.fake.calls.length
    const askSession = await ruledSession(host, [{ action: "linear_list_issues", resource: "*", effect: "ask" }])
    const asked = await run(askSession, "list_issues")
    expect(asked).toHaveProperty("refused")
    expect((asked as { refused: string }).refused).toMatch(/needs approval|nobody is present|not permitted|declined/i)
    expect(host.fake.calls.slice(asking)).toEqual([])
    expect(await host.client.permission.list({ sessionID: askSession })).toEqual([])

    // A deny refuses, and a name that is not a method is not callable.
    const denied = await run(await ruledSession(host, [deny("list_issues")]), "list_issues")
    expect(denied).toHaveProperty("refused")
    expect(denied).toMatchObject({ refused: expect.stringMatching(/Permission denied: linear_list_issues|not permitted/i) })
    expect(await run(await session(host), "no_such_tool")).toHaveProperty("refused")
    expect(host.fake.calls.slice(asking)).toEqual([])
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

  test("linear_events_list asserts its own action on the real host, then reads through the host's executors", async () => {
    await linearTools(host)
    const events = (await host.probe().tool.list()).find((tool) => tool.id === "linear_events_list")!
    const run = (sessionID: string, id: string) =>
      events.execute({ since: "2026-11-01" }, { sessionID, agent: "build", messageID: "msg_host_test", id, signal: new AbortController().signal, progress: async () => {} } as never)
    const from = host.fake.inputs.length
    // The default rules allow it; the fake serves no get_workspace, so its first read names that.
    await expect(run(await session(host), "call_events_1")).rejects.toThrow(/^TOOL_UNAVAILABLE: OpenCode does not list Linear's get_workspace/)
    // A session that denies linear_events_list: the assert refuses it before any read.
    const permissions = [{ action: "linear_events_list", resource: "*", effect: "deny" as const }]
    const locked = (await host.client.sessions.create({ agent: "build", location: host.location, permissions })).id
    await expect(run(locked, "call_events_2")).rejects.toThrow("linear_events_list")
    expect(host.fake.inputs.length).toBe(from)
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
    expect(text).toContain(`- Connection: connected (${host.fake.endpoints.all}, registered by this plugin)`)
    expect(text).toContain("- Tools: 4 available, 1 unknown: shiny_new_tool (unknown tools run too)\n")
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
      config: (url) => ({ mcp: { servers: { linear: { type: "remote", url, oauth: false, headers: { "x-linear-test": "user" } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("H4: the user's server is adopted unchanged", async () => {
    await attempt(host, await session(host), "build", "list_issues")
    expect(host.fake.markers.length).toBeGreaterThan(0)
    expect(new Set(host.fake.markers)).toEqual(new Set(["user"]))
    const text = await status(host, await session(host))
    expect(text).toContain(`- Connection: connected (${host.fake.endpoints.all}, your own mcp.servers.linear, used unchanged)`)
    expect(text).toContain("- Access: every tool runs without asking, reads, changes and new tools included")
  })

  test("the default access runs a write without a prompt, and the write skill is registered", async () => {
    const build = await session(host)
    expect(hidden((await agentRules(host)).get("build")!, "linear_save_issue")).toBe(false)
    expect(await attempt(host, build, "build", "save_issue")).toEqual({ asked: undefined, ok: true })
    expect(await attempt(host, build, "build", "list_issues")).toEqual({ asked: undefined, ok: true })
    const { data: skills } = await host.client.skill.list({ location: host.location })
    expect(skills.map((skill) => skill.id).filter((id) => id.startsWith("linear")).sort()).toEqual(["linear", "linear-write"])
  })
})

describe("user permissions", () => {
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
    expect(await attempt(host, build, "build", "shiny_new_tool")).toEqual({ asked: undefined, ok: true })
  })

  test("P5: the per-agent fix guards a config-only agent and keeps the user's rules winning", async () => {
    const reviewer = await session(host, "reviewer")
    expect(await attempt(host, reviewer, "reviewer", "shiny_new_tool")).toEqual({ asked: undefined, ok: true })
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
    expect(text).toContain(`- Next step: Your OpenCode config defines mcp.servers.linear with ${other}, but access "all" uses ${host.fake.endpoints.all}.`)
  })
})

// R18: one host per access value on the tools RPC path: the block that value generates, a read, and a write.
describe(`access on OpenCode ${HOST_VERSION}`, () => {
  for (const access of ["all", "ask-changes", "read-only"] as const) {
    describe(access, () => {
      let host: Host
      beforeAll(async () => {
        host = await startHost({ options: { access } })
        // The tools RPC resolves a method only once OpenCode lists its tool.
        await until("Linear's tools are registered", async () => (await host.probe().tool.list()).some((tool) => tool.id === "linear_list_issues"))
      })
      afterAll(() => host?.close())

      test("the block is generated from defaultRules(access), and a read runs on the tools RPC path", async () => {
        const rules = (await agentRules(host)).get("build")!
        expect(rules.slice(1, 1 + defaultRules(access).length)).toEqual(defaultRules(access))
        const before = host.fake.calls.length
        const read = await script(host, await session(host), "list_issues")
        expect(read.value).toMatchObject({ output: { tool: "list_issues" } })
        expect(host.fake.calls.slice(before)).toEqual(["list_issues"])
      })

      test(`a write on the tools RPC path follows ${access}`, async () => {
        const sessionID = await session(host)
        const before = host.fake.calls.length
        const result = await script(host, sessionID, "save_issue")
        if (access === "all") {
          expect(result.value).toMatchObject({ output: { tool: "save_issue" } })
          expect(host.fake.calls.slice(before)).toEqual(["save_issue"])
        } else {
          expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
          // Nothing reaches Linear, and no approval prompt is left waiting.
          expect(host.fake.calls.slice(before)).toEqual([])
          expect(await host.client.permission.list({ sessionID })).toEqual([])
        }
      })
    })
  }

  // The deprecated values are the same switch, with a note in status.
  test("the deprecated read and write values map onto access, and status says so", async () => {
    const host = await startHost({ options: { access: "read" } })
    try {
      const { data } = await host.client.rpc.call({ rpcID: "linear.workspace", method: "status", input: {}, location: host.location }).then((result) => ({ data: result.output as Record<string, unknown> }))
      expect(data).toMatchObject({ access: "read-only" })
      expect(String(data.deprecation)).toContain('The access value "read" is deprecated: it means "read-only".')
    } finally {
      await host.close()
    }
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
