import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { defaultRules } from "../../src/permissions.js"
import { AGENTS_FIX, buildStatus, NOTHING_TO_DO, formatStatus, readStatus, registerStatusCommand, registerStatusRpc, SIGN_IN, StatusRpc, type Status, type StatusContext, type StatusFacts } from "../../src/status.js"
import { allow } from "./fake.js"

const host = checkHost("2.2.3", false)
const READ_URL = "https://mcp.linear.app/mcp/readonly"
const base: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: READ_URL }, access: "read", host }
const guarded = { id: "build", permissions: [allow("*"), ...defaultRules()] }

describe("buildStatus", () => {
  test("connected, with nothing left to do", () => {
    const status = buildStatus({ ...base, account: "Acme", tools: ["list_issues"], agents: [guarded] })
    expect(status).toEqual({ connection: "connected", account: "Acme", access: "read", source: { type: "plugin", url: READ_URL }, tools: 1, unknownTools: [], agentsWithoutRules: [], host, problems: [], nextStep: "Nothing to do." })
    expect(formatStatus(status)).toBe(
      [
        "Linear status",
        "- Connection: connected (https://mcp.linear.app/mcp/readonly, registered by this plugin)",
        "- Account: Acme",
        "- Access: read-only (Linear's read-only server; changes are not available)",
        "- Tools: 1 available, 0 unknown",
        "- Agents without default rules: none",
        "- OpenCode: 2.2.3 (tested)",
        "- Next step: Nothing to do.",
      ].join("\n"),
    )
  })

  test.each([
    [{ status: "needs_auth", error: "Authorization required" }, "needs_sign_in", SIGN_IN],
    [{ status: "failed", error: "fetch failed" }, "failed", "Check your network, then run /linear-status again."],
    [{ status: "disabled" }, "disabled", `The linear MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.linear in opencode.json.`],
    [{ status: "pending" }, "pending", "Linear is still connecting. Run /linear-status again in a few seconds."],
    [undefined, "not_configured", "OpenCode has no linear MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode."],
  ] as const)("%j is %s with the exact next step", (server, connection, nextStep) => {
    const status = buildStatus({ ...base, ...(server ? { server } : { server: undefined }) })
    expect(status.connection).toBe(connection)
    expect(status.nextStep).toBe(nextStep)
    expect(formatStatus(status)).toContain(`- Next step: ${nextStep}`)
    if (server && "error" in server) expect(formatStatus(status)).toContain(`(${server.error}; `)
  })

  test("the sign-in step says the user opens the link in the TUI, and only the CLI opens it automatically", () => {
    expect(SIGN_IN).toBe("Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth linear opens it automatically).")
  })

  test("names the account as unreported when Linear does not provide one", () => {
    expect(formatStatus(buildStatus(base))).toContain("- Account: account name not reported by Linear's MCP")
  })

  test("adopted and conflicting servers", () => {
    expect(formatStatus(buildStatus({ ...base, source: { type: "adopted", url: READ_URL } }))).toContain(`- Connection: connected (${READ_URL}, your own mcp.servers.linear, used unchanged)`)
    const conflict = buildStatus({ ...base, source: { type: "conflict", url: "https://linear.example.com/mcp", expected: READ_URL } })
    expect(conflict.nextStep).toBe(
      `Your OpenCode config defines mcp.servers.linear with https://linear.example.com/mcp, but access "read" uses ${READ_URL}. Point it at ${READ_URL} or remove it, then restart OpenCode.`,
    )
    expect(formatStatus(conflict)).toContain("- Connection: conflict (your mcp.servers.linear points at https://linear.example.com/mcp)")
  })

  test("counts the visible tools and names the unknown ones", () => {
    const status = buildStatus({ ...base, tools: ["list_issues", "save_issue", "shiny_new_tool", "create_issue"] })
    expect(status.tools).toBe(4)
    expect(status.unknownTools).toEqual(["shiny_new_tool", "create_issue"])
    expect(formatStatus(status)).toContain("- Tools: 4 available, 2 unknown: shiny_new_tool, create_issue (unknown tools ask before running)")
  })

  test("counts linear_issues as the plugin's own tool, not an unknown one", () => {
    const status = buildStatus({ ...base, tools: ["list_issues", "issues"] })
    expect(status.tools).toBe(2)
    expect(status.unknownTools).toEqual([])
  })

  test("names agents without the default rules, with the block to paste, and points the next step at it", () => {
    const status = buildStatus({ ...base, access: "write", agents: [guarded, { id: "reviewer", permissions: [allow("*")] }] })
    expect(status.agentsWithoutRules).toEqual(["reviewer"])
    expect(status.nextStep).toBe(`Add the block above to each listed agent's own "permissions".`)
    expect(AGENTS_FIX).toContain(`first in each listed agent's own "permissions"`)
    expect(AGENTS_FIX).toContain(`followed by your top-level "permissions" rules for linear_* tools`)
    // One rule a line, as a JSON array body that pastes into a permissions list.
    expect(JSON.parse(`[${AGENTS_FIX.split("\n").slice(1).join("\n")}]`)).toEqual(defaultRules())
    const text = formatStatus(status)
    expect(text).toContain(`- Agents without default rules: reviewer. Linear tools run there without asking. ${AGENTS_FIX}\n`)
    expect(text.indexOf("- Agents without")).toBeLessThan(text.indexOf("- OpenCode:"))
    expect(text.indexOf("- Tools:")).toBeLessThan(text.indexOf("- Agents without"))
  })

  test("the sign-in step comes before the agent fix, which still shows, and there is one next step", () => {
    const status = buildStatus({ ...base, server: { status: "needs_auth", error: "x" }, agents: [{ id: "reviewer", permissions: [allow("*")] }] })
    expect(status.nextStep).toBe(SIGN_IN)
    const text = formatStatus(status)
    expect(text).toContain("- Connection: sign-in required (x; ")
    expect(text).toContain("- Agents without default rules: reviewer.")
    expect(text.match(/Next step/g)).toHaveLength(1)
  })

  test("the rows come in the standard order", () => {
    const rows = formatStatus(buildStatus(base)).split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2, line.indexOf(":")))
    expect(rows).toEqual(["Connection", "Account", "Access", "Tools", "Agents without default rules", "OpenCode", "Next step"])
  })

  test("an untested host and setup problems show on the OpenCode row; a problem's own next step comes first", () => {
    const untested = checkHost("2.3.0", true)
    const problem = 'SKILLS_INVALID: The "linear" skill was not loaded: skills/linear/SKILL.md is missing. Next step: Reinstall the plugin.'
    const status = buildStatus({ ...base, host: untested, problems: [problem] })
    expect(status.nextStep).toBe("Reinstall the plugin.")
    expect(formatStatus(status)).toContain(`- OpenCode: 2.3.0 (host untested). ${untested.warning} ${problem}`)
    expect(buildStatus({ ...base, host: untested }).nextStep).toBe("If Linear misbehaves, use OpenCode >=2.2.3 <2.3.0.")
    expect(buildStatus(base).nextStep).toBe(NOTHING_TO_DO)
  })

  test("write access says each change asks", () => {
    expect(formatStatus(buildStatus({ ...base, access: "write" }))).toContain("- Access: read and write (each change asks before it runs)")
  })
})

function statusContext(overrides: { account?: Promise<unknown>; integrationID?: string } = {}) {
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "github", status: { status: "connected" } }, { name: "linear", status: { status: "connected" }, ...(overrides.integrationID ? { integrationID: overrides.integrationID } : {}) }] }) },
    agent: { list: async () => ({ data: [guarded, { id: "reviewer", permissions: [allow("*")] }] }) },
    tool: {
      list: async () => [
        { id: "linear_list_issues", name: "list_issues", options: { namespace: "linear" } },
        { id: "linear_shiny_new_tool", name: "shiny_new_tool", options: { namespace: "linear" } },
        { id: "linear_work_get_me", name: "get_me", options: { namespace: "linear_work" } },
        { id: "read", name: "read" },
      ],
    },
    integration: { connection: { active: () => overrides.account ?? Promise.resolve(undefined) } },
  }
  return ctx as unknown as StatusContext
}

describe("readStatus", () => {
  test("reads connection, account, tools and agents through public APIs", async () => {
    const account = Promise.resolve({ type: "credential", id: "c", label: "Acme workspace", method: "oauth" })
    const status = await readStatus(statusContext({ integrationID: "mcp_1", account }), { source: { type: "plugin", url: READ_URL }, access: "read", host, problems: [] })
    expect(status).toMatchObject({ connection: "connected", account: "Acme workspace", unknownTools: ["shiny_new_tool"], agentsWithoutRules: ["reviewer"] })
  })

  test("a failed account lookup leaves the account unreported", async () => {
    const status = await readStatus(statusContext({ integrationID: "mcp_1", account: Promise.reject(new Error("offline")) }), { access: "read", host })
    expect(status.account).toBeUndefined()
    expect(status.connection).toBe("connected")
  })
})

describe("/linear-status", () => {
  async function run(read: () => Promise<never> | ReturnType<typeof readStatus>) {
    const posted: unknown[] = []
    let execute: ((input: { sessionID: string }) => Promise<void>) | undefined
    await registerStatusCommand(
      {
        command: { transform: async (callback) => (callback({ add: (definition) => void (execute = definition.execute as never) }), { dispose: async () => {} }) },
        session: { synthetic: async (input) => (posted.push(input), {}) as never },
      },
      read,
    )
    await execute!({ sessionID: "ses_1" })
    return posted
  }

  test("posts the status text into the session without starting a turn", async () => {
    const posted = await run(async () => buildStatus(base))
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(base)), description: "Linear status", resume: false }])
  })

  test("posts a coded error with a next step when status cannot be read", async () => {
    const posted = (await run(() => Promise.reject(new Error("host closed")))) as { text: string }[]
    expect(posted[0]!.text).toBe(
      "STATUS_UNAVAILABLE: Could not read Linear's status (host closed). Next step: Restart OpenCode, then run /linear-status again.",
    )
  })
})

describe("status RPC", () => {
  test("serves the same status as /linear-status through one read-only method", async () => {
    const registered: { id: string; methods: string[]; status?: () => Promise<unknown> }[] = []
    await registerStatusRpc(
      {
        register: async (definition, handlers) => {
          registered.push({ id: definition.id, methods: Object.keys(definition.methods), status: () => handlers.status({} as never, {} as never) })
          return { dispose: async () => {}, events: { emit: async () => {} } } as never
        },
      },
      async () => buildStatus(base),
    )
    expect(registered.map(({ id, methods }) => ({ id, methods }))).toEqual([{ id: "linear.workspace", methods: ["status"] }])
    expect(await registered[0]!.status!()).toEqual(buildStatus(base))
    expect(StatusRpc.events).toEqual({})
  })

  test("the output schema names every status field and requires the ones always present", () => {
    const { properties, required } = StatusRpc.methods.status.output
    const statuses: Status[] = [
      buildStatus({ ...base, account: "Acme", tools: ["shiny_new_tool"], agents: [{ id: "reviewer", permissions: [allow("*")] }], problems: ["p"] }),
      buildStatus({ ...base, server: { status: "failed", error: "fetch failed" }, source: { type: "conflict", url: "https://x.example/mcp", expected: READ_URL }, host: checkHost("2.3.0", true) }),
    ]
    for (const status of statuses) {
      expect(Object.keys(status).filter((key) => !(key in properties))).toEqual([])
      expect(required.filter((key) => !(key in status))).toEqual([])
      expect(Object.keys(status.host).filter((key) => !(key in properties.host.properties))).toEqual([])
    }
  })
})
