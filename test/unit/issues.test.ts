import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { issueList, issueRows, issuesMethod, issuesTool, registerIssuesTool } from "../../src/issues.js"
import { defaultRules, evaluate } from "../../src/permissions.js"
import { buildStatus, type StatusFacts } from "../../src/status.js"

/** Linear's live `list_issues` answer: `id` is the identifier, `status` a name and `priority` `{ value, name }`. */
const issue = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `ENG-${n}`,
  title: `Issue ${n}`,
  status: "In Progress",
  priority: { value: 2, name: "High" },
  url: `https://linear.app/acme/issue/ENG-${n}`,
  ...extra,
})

/** The host's `linear_list_issues` executor, which answers with the server's structured content as `output`. */
/** The signed-in workspace and user the list checks its account against, as `get_workspace` and `get_user` "me". */
const WORKSPACE = { id: "acme", urlKey: "acme", name: "Acme" }
const ME = { id: "u_1", email: "sam.rivera@example.com", name: "Sam Rivera" }
const ACCOUNT = "acme/sam.rivera@example.com"

function host(answer: unknown, options: { readonly identity?: "fail" } = {}) {
  const calls: unknown[] = []
  /** Only the list_issues call goes in `calls`; the two identity reads go in `reads`. */
  const reads: unknown[] = []
  const entry = (id: string, execute: (args: Record<string, unknown>) => unknown) => ({
    id,
    execute: async (args: Record<string, unknown>) => {
      if (id === "linear_list_issues") calls.push(args)
      else reads.push({ tool: id, args })
      return { output: execute(args), content: [{ type: "text", text: JSON.stringify(execute(args)) }] }
    },
  })
  const list = async () =>
    [
      entry("linear_list_issues", () => answer),
      entry("linear_get_workspace", () => (options.identity === "fail" ? {} : WORKSPACE)),
      entry("linear_get_user", () => (options.identity === "fail" ? {} : ME)),
    ] as never
  return { tool: { list }, calls, reads }
}

const facts: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: "https://mcp.linear.app/mcp" }, access: "all", host: checkHost("2.4.1", false) }
const status = (more: Partial<StatusFacts> = {}) => async () => buildStatus({ ...facts, ...more })
const owned = () => true
const SIGN_IN = "Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth linear opens it automatically)."
const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never

describe("linear.issues list snapshot", () => {
  test("reads assigned issues through list_issues and returns the list shape", async () => {
    const { tool, calls, reads } = host({
      issues: [issue(1), issue(2, { status: "Done", title: "Ship it" }), issue(3, { status: "Canceled" })],
      hasNextPage: true,
    })
    const asserted: unknown[] = []
    const result = await issuesMethod({
      tool,
      owned,
      status: status(),
      permission: { assert: async (input) => void asserted.push(input) },
    }).run({ source: "linear", account: ACCOUNT }, context as never)
    // The two identity reads come first, then the same list_issues call the table makes.
    expect(reads).toEqual([
      { tool: "linear_get_workspace", args: {} },
      { tool: "linear_get_user", args: { query: "me" } },
    ])
    expect(calls).toEqual([{ assignee: "me", limit: 50, fields: ["id", "title", "status", "priority", "url"] }])
    expect(asserted).toEqual([expect.objectContaining({ action: "linear_issues", resources: ["*"] })])
    expect(result).toMatchObject({
      account: ACCOUNT,
      trust: "untrusted",
      data: {
        editable: false,
        items: [
          { id: "ENG-1", text: "Issue 1", note: "In Progress" },
          { id: "ENG-2", text: "Ship it", note: "Done", done: true },
          { id: "ENG-3", text: "Issue 3", note: "Canceled", done: true },
        ],
      },
    })
    expect(issueList([])).toEqual([])
  })

  test("leaves out an issue whose title, state or identifier holds a secret", () => {
    const items = issueList([
      { identifier: "ENG-1", title: "Rotate the staging key", state: "In Progress", priority: null, url: null },
      { identifier: "ENG-2", title: "Wifi password: Ku7pLm2QzR9w", state: "Todo", priority: null, url: null },
      { identifier: "ENG-3", title: "Plain title", state: "token sk-live-9d8f7g6h5j4k3l2m1n0p", priority: null, url: null },
      { identifier: "ENG-4", title: "Another plain title", state: "Done", priority: null, url: null },
    ])
    expect(items).toEqual([
      { id: "ENG-1", text: "Rotate the staging key", note: "In Progress" },
      { id: "ENG-4", text: "Another plain title", note: "Done", done: true },
    ])
  })
})

describe("linear.issues list rules", () => {
  const row = (n: number, extra: Partial<{ identifier: string; title: string; state: string | null }> = {}) => ({ identifier: `ENG-${n}`, title: `Issue ${n}`, state: "Todo", priority: null, url: null, ...extra })

  test("screens the whole title before the cut, screens the id, and lists a repeated identifier once", () => {
    // A secret that only appears after the 200-character cut is still caught.
    expect(issueList([row(1, { title: `${"a".repeat(196)}Password: Ku7pLm2QzR9w` })])).toEqual([])
    // An identifier that is a token is left out.
    expect(issueList([row(2, { identifier: "ghp_A1b2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8" })])).toEqual([])
    // A repeated identifier is listed once, the first row winning.
    expect(issueList([row(3, { title: "First" }), row(3, { title: "Second" })])).toEqual([{ id: "ENG-3", text: "First", note: "Todo" }])
  })

  test("caps at 50 items, keeps the order it is given, and holds maxBytes with 50 maximal multi-byte items", () => {
    const many = Array.from({ length: 60 }, (_, index) => row(index, { title: `Issue ${index}` }))
    const capped = issueList(many)
    expect(capped).toHaveLength(50)
    expect(capped.map((item) => item.id)).toEqual(many.slice(0, 50).map((item) => item.identifier))
    // Three-byte characters everywhere the caps allow (128-unit identifier, 200-unit title, 200-unit state): 50 such
    // items come to about 79 KB, so the answer has to shed whole items to stay inside the declared maxBytes.
    const maximal = Array.from({ length: 50 }, (_, index) =>
      row(index, { identifier: `语${index}`.padEnd(128, "语"), title: "语".repeat(200), state: "语".repeat(200) }),
    )
    const items = issueList(maximal)
    const answer = { account: "acme/sam.rivera@example.com", data: { items, editable: false }, asOf: new Date().toISOString(), trust: "untrusted" }
    expect(Buffer.byteLength(JSON.stringify(answer))).toBeLessThanOrEqual(65_536)
    // Fewer than 50, and every item whole.
    expect(items.length).toBeLessThan(50)
    expect(items.length).toBeGreaterThan(0)
  })

  test("refuses another account than the signed-in one, and answers the signed-in account when none is passed", async () => {
    const { tool, calls } = host({ issues: [issue(1)], hasNextPage: false })
    const method = (given: Record<string, unknown>) => issuesMethod({ tool, owned, status: status() }).run(given, context as never)
    await expect(method({ source: "linear", account: "other-workspace/other@example.com" })).rejects.toThrow(
      /^ACCOUNT_MISMATCH: Linear is signed in to another account than "other-workspace\/other@example\.com"\./,
    )
    // The refusal comes before the issues are read.
    expect(calls).toEqual([])
    const answer = (await method({ source: "linear" })) as { account: string }
    expect(answer.account).toBe(ACCOUNT)
  })
})

describe("linear_issues", () => {
  test("asks Linear only for the fields the table shows, and answers the table from Linear's live shape", async () => {
    const { tool, calls } = host({
      issues: [issue(1), issue(2, { status: "Todo", priority: { value: 0, name: "No priority" }, url: "http://insecure" }), { title: "No id, skipped" }],
      hasNextPage: false,
    })
    const result = await issuesTool({ tool, owned, status: status() }).execute({ limit: 10 }, context)
    expect(calls).toEqual([{ assignee: "me", limit: 10, fields: ["id", "title", "status", "priority", "url"] }])
    // The table is strict: exactly these two keys, at most 8 columns.
    expect(Object.keys(result.output)).toEqual(["columns", "rows"])
    expect(result.output.columns).toEqual([
      { key: "identifier", label: "Issue" },
      { key: "title", label: "Title" },
      { key: "state", label: "State" },
      { key: "priority", label: "Priority" },
      { key: "url", label: "Link" },
    ])
    expect(result.output.rows).toEqual([
      { identifier: "ENG-1", title: "Issue 1", state: "In Progress", priority: "High", url: "https://linear.app/acme/issue/ENG-1" },
      { identifier: "ENG-2", title: "Issue 2", state: "Todo", priority: "No priority", url: null },
    ])
    expect(result.content).toBe(
      [
        "Issue | Title | State | Priority | Link",
        "ENG-1 | Issue 1 | In Progress | High | https://linear.app/acme/issue/ENG-1",
        "ENG-2 | Issue 2 | Todo | No priority | no link",
        "",
        "These are all 2 issues assigned to you, in every state.",
      ].join("\n"),
    )
  })

  test("tells the model when Linear has more, and that the rows are no count", async () => {
    const { tool } = host({ issues: [issue(1), issue(2)], hasNextPage: true, cursor: "c1" })
    const result = await issuesTool({ tool, owned, status: status() }).execute({ limit: 2 }, context)
    expect(result.output.rows).toHaveLength(2)
    expect(result.content.split("\n").at(-1)).toBe(
      'Linear has more assigned issues than these 2, the most recently updated. This is not a count: for totals or one state, call list_issues with assignee "me" and the filters, and page until hasNextPage is false.',
    )
  })

  test("keeps the limit a whole number between 1 and 100, 25 by default", async () => {
    const { tool, calls } = host({ issues: [], hasNextPage: false })
    for (const input of [{}, { limit: 1000 }, { limit: 0 }, { limit: -5 }, { limit: 2.7 }, { limit: Number.NaN }, { limit: "7" }]) {
      await issuesTool({ tool, owned, status: status() }).execute(input, context)
    }
    expect(calls.map((call) => (call as { limit: number }).limit)).toEqual([25, 100, 1, 1, 2, 25, 25])
  })

  test("never calls a linear server that is not Linear's for this access", async () => {
    const { tool, calls } = host({ issues: [] })
    const conflict = status({ source: { type: "conflict", url: "https://example.com/mcp", expected: "https://mcp.linear.app/mcp" } })
    const run = issuesTool({ tool, owned: () => false, status: conflict }).execute({}, context)
    await expect(run).rejects.toThrow(
      /^SERVER_CONFLICT: Your mcp\.servers\.linear is not Linear's server for access "all", so linear_issues does not call it\. Next step: Your OpenCode config defines mcp\.servers\.linear with https:\/\/example\.com\/mcp/,
    )
    expect(calls).toEqual([])
  })

  test("names the server's state and its status next step when OpenCode does not list list_issues", async () => {
    const none = { list: async () => [] as never }
    const run = (more: Partial<StatusFacts>) => issuesTool({ tool: none, owned, status: status(more) }).execute({}, context)
    await expect(run({ server: { status: "needs_auth" } })).rejects.toThrow(`AUTH_REQUIRED: Linear needs a sign-in, so its list_issues is unavailable. Next step: ${SIGN_IN}`)
    await expect(run({ server: { status: "disabled" } })).rejects.toThrow(
      "TOOL_UNAVAILABLE: OpenCode does not list Linear's list_issues (the linear server is disabled). Next step: The linear MCP server is disabled.",
    )
    await expect(run({})).rejects.toThrow(
      "TOOL_UNAVAILABLE: OpenCode does not list Linear's list_issues (the linear server is connected). Next step: Wait a few seconds, then run /linear-status and follow its next step.",
    )
    const broken = issuesTool({ tool: none, owned, status: async () => Promise.reject(new Error("agents unavailable")) })
    await expect(broken.execute({}, context)).rejects.toThrow(/^TOOL_UNAVAILABLE: OpenCode does not list Linear's list_issues\. Next step: Wait a few seconds/)
  })

  test("passes a refusal or an error of list_issues through unchanged", async () => {
    const denied = new Error("Permission denied: linear_list_issues")
    const tool = { list: async () => [{ id: "linear_list_issues", execute: async () => Promise.reject(denied) }] as never }
    await expect(issuesTool({ tool, owned, status: status() }).execute({}, context)).rejects.toBe(denied)
  })

  test("fails on any other answer rather than showing an empty table, with one next step", () => {
    for (const answer of ["Not a list", [issue(1)], { nodes: [issue(1)] }, undefined]) {
      expect(() => issueRows(answer)).toThrow(
        `UPSTREAM_UNREADABLE: Linear's list_issues did not answer with a list of issues. Next step: Call list_issues with assignee "me" instead, which returns Linear's answer as it is.`,
      )
    }
  })

  test("cuts a long cell to 200 characters", () => {
    expect(issueRows({ issues: [issue(3, { title: "t".repeat(400) })] }).rows[0]?.title.length).toBe(200)
  })

  test("is a Code Mode tool in the linear namespace, and runs without asking like Linear's reads", async () => {
    const added: { name: string; options: unknown; description: string }[] = []
    await registerIssuesTool({
      tool: {
        list: async () => [] as never,
        transform: (async (callback: (editor: unknown) => void) => {
          callback({ add: (tool: { name: string; options: unknown; description: string }) => added.push(tool) })
          return { dispose: async () => undefined }
        }) as never,
      },
      owned,
      status: status(),
    })
    expect(added.map((tool) => [tool.name, tool.options])).toEqual([["issues", { namespace: "linear" }]])
    // Its description says it is a sample, and where totals and filters come from.
    expect(added[0]!.description).toMatch(/not a count: every state .* most recently updated first, 25 rows by default and at most 100/)
    expect(added[0]!.description).toContain('use list_issues with assignee "me" and page until hasNextPage is false')
    expect(evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules()], "linear_issues")).toBe("allow")
  })
})
