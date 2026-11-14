import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { issueRows, issuesTool, registerIssuesTool } from "../../src/issues.js"
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
function host(answer: unknown) {
  const calls: unknown[] = []
  const list = async () =>
    [
      {
        id: "linear_list_issues",
        execute: async (args: unknown) => {
          calls.push(args)
          return { output: answer, content: [{ type: "text", text: JSON.stringify(answer) }] }
        },
      },
    ] as never
  return { tool: { list }, calls }
}

const facts: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: "https://mcp.linear.app/mcp" }, access: "all", host: checkHost("2.2.3", false) }
const status = (more: Partial<StatusFacts> = {}) => async () => buildStatus({ ...facts, ...more })
const owned = () => true
const SIGN_IN = "Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth linear opens it automatically)."
const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never

describe("linear_issues", () => {
  test("asks Linear only for the fields the table shows, and answers Jelly's table from Linear's live shape", async () => {
    const { tool, calls } = host({
      issues: [issue(1), issue(2, { status: "Todo", priority: { value: 0, name: "No priority" }, url: "http://insecure" }), { title: "No id, skipped" }],
      hasNextPage: false,
    })
    const result = await issuesTool({ tool, owned, status: status() }).execute({ limit: 10 }, context)
    expect(calls).toEqual([{ assignee: "me", limit: 10, fields: ["id", "title", "status", "priority", "url"] }])
    // Jelly's table template is strict: exactly these two keys, at most 8 columns.
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

  test("cuts a long cell to Jelly's 200 characters", () => {
    expect(issueRows({ issues: [issue(3, { title: "t".repeat(400) })] }).rows[0]?.title.length).toBe(200)
  })

  test("is a direct tool in the linear namespace, and runs without asking like Linear's reads", async () => {
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
    expect(added.map((tool) => [tool.name, tool.options])).toEqual([["issues", { namespace: "linear", codemode: false }]])
    // Its description says it is a sample, and where totals and filters come from.
    expect(added[0]!.description).toMatch(/not a count: every state .* most recently updated first, 25 rows by default and at most 100/)
    expect(added[0]!.description).toContain('use list_issues with assignee "me" and page until hasNextPage is false')
    expect(evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules()], "linear_issues")).toBe("allow")
  })
})
