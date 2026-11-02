import { describe, expect, test } from "bun:test"
import { COLUMNS, ISSUES_ACTION, issueRows, issuesTool, registerIssuesTool, resultData } from "../../src/issues.js"
import { defaultRules, evaluate } from "../../src/permissions.js"

/** The host's `linear_list_issues` executor, answering with JSON text as Linear's server does. */
function host(answer: unknown) {
  const calls: unknown[] = []
  const list = async () =>
    [
      {
        id: "linear_list_issues",
        execute: async (args: unknown) => {
          calls.push(args)
          return { content: [{ type: "text", text: JSON.stringify(answer) }] }
        },
      },
    ] as never
  return { tool: { list }, calls }
}

const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never

describe("linear_issues", () => {
  test("answers Jelly's table template from the assigned issues", async () => {
    const { tool, calls } = host({
      issues: [
        { identifier: "ENG-1", title: "Fix login", state: { name: "In Progress" }, priority: 2, url: "https://linear.app/acme/issue/ENG-1" },
        { id: "abc", identifier: "ENG-2", title: "Docs", status: "Todo", priorityLabel: "Low" },
        { title: "No identifier, skipped" },
      ],
    })
    const result = await issuesTool(tool).execute({ limit: 10 }, context)
    expect(calls).toEqual([{ assignee: "me", limit: 10 }])
    expect(result.output.columns).toEqual(COLUMNS.map((column) => ({ ...column })))
    expect(result.output.rows).toEqual([
      { identifier: "ENG-1", title: "Fix login", state: "In Progress", priority: "High", url: "https://linear.app/acme/issue/ENG-1" },
      { identifier: "ENG-2", title: "Docs", state: "Todo", priority: "Low", url: null },
    ])
    // Jelly's table: at most 8 columns, each cell at most 200 characters.
    expect(result.output.columns.length).toBeLessThanOrEqual(8)
  })

  test("keeps the limit between 1 and 100, 25 by default", async () => {
    const { tool, calls } = host([])
    await issuesTool(tool).execute({}, context)
    await issuesTool(tool).execute({ limit: 1000 }, context)
    expect(calls).toEqual([{ assignee: "me", limit: 25 }, { assignee: "me", limit: 100 }])
  })

  test("says the server is not signed in, rather than answering an empty table", async () => {
    const tool = { list: async () => [] as never }
    await expect(issuesTool(tool).execute({}, context)).rejects.toThrow(/AUTH_REQUIRED/)
    expect(() => issueRows("Not a list")).toThrow(/LINEAR_UNREADABLE/)
  })

  test("cuts a long cell to Jelly's 200 characters", () => {
    expect(issueRows([{ identifier: "ENG-3", title: "t".repeat(400) }])[0]?.title.length).toBe(200)
    expect(resultData({ output: [1] })).toEqual([1])
  })

  test("is a direct tool in the linear namespace, and runs without asking like Linear's reads", async () => {
    const added: { name: string; options: unknown }[] = []
    await registerIssuesTool({
      list: async () => [] as never,
      transform: (async (callback: (editor: unknown) => void) => {
        callback({ add: (tool: { name: string; options: unknown }) => added.push(tool) })
        return { dispose: async () => undefined }
      }) as never,
    })
    expect(added.map((tool) => [tool.name, tool.options])).toEqual([["issues", { namespace: "linear", codemode: false }]])
    expect(evaluate([{ action: "*", resource: "*", effect: "allow" }, ...defaultRules()], ISSUES_ACTION)).toBe("allow")
  })
})
