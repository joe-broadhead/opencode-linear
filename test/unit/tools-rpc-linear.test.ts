// Linear's part of the tools RPC: its plugin value in src/tools-rpc.ts. The shared part, the source contract's, is tested
// in tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as LINEAR_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN, PLUGIN_ID, TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import { DESTRUCTIVE_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { defaultRules } from "../../src/permissions.js"

const ISSUES_ACTION = "linear_issues"
const EVENTS_ACTION = "linear_events_list"
const PROBE_ACTION = "linear_probe"

describe("Linear's tools RPC", () => {
  test("is linear.workspace.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(LINEAR_PLUGIN_ID)
    expect(PLUGIN.id).toBe(LINEAR_PLUGIN_ID)
    expect(PLUGIN.nextSteps).toBe(NEXT_STEPS)
    expect(TOOLS_RPC_ID).toBe("linear.workspace.tools")
  })

  test("its MCP methods are the 41 known reads, the 32 other changes and the 5 destructive ones, each with its class", () => {
    expect(METHODS.map((method) => method.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(METHODS.filter((method) => method.class === "read").map((method) => method.name)).toEqual([...READ_TOOLS])
    expect(METHODS.filter((method) => method.class === "destructive").map((method) => method.name)).toEqual([...DESTRUCTIVE_TOOLS])
    expect(METHODS.filter((method) => method.class === "write").map((method) => method.name)).toEqual(WRITE_TOOLS.filter((name) => !DESTRUCTIVE_TOOLS.includes(name)))
    expect(READ_TOOLS).toHaveLength(41)
    expect(WRITE_TOOLS).toHaveLength(37)
    // Every known tool is allowed by default, the pattern that covers a tool Linear adds later included; the plugin's
    // own linear_issues is the owned method `issues`, not an MCP one.
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    // The reads, the plugin's own `issues` and `events_list`, the contract's `probe`, then the writes: the block's order.
    expect(allowed).toEqual([`${SERVER_NAME}_*`, ...READ_TOOLS.map((name) => `${SERVER_NAME}_${name}`), ISSUES_ACTION, EVENTS_ACTION, PROBE_ACTION, ...WRITE_TOOLS.map((name) => `${SERVER_NAME}_${name}`)])
    expect(METHODS.map((method) => method.name)).not.toContain("issues")
    expect(METHODS.map((method) => method.name)).not.toContain("events_list")
    expect(METHODS.map((method) => method.name)).not.toContain("probe")
  })

  test("pins every tool's class, so a delete cannot quietly move back to write", () => {
    const classOf = new Map(METHODS.map((method) => [method.name, method.class]))
    // The four deletes and a merged diff cannot be undone by another Linear tool: they are destructive.
    for (const name of ["delete_attachment", "delete_comment", "delete_diff_comment", "delete_status_update", "merge_diff"]) expect({ name, class: classOf.get(name) }).toEqual({ name, class: "destructive" })
    // `retire_*` stays a write, because `restore_*` undoes it.
    for (const name of ["retire_initiative_label", "retire_issue_label", "retire_project_label"]) expect({ name, class: classOf.get(name) }).toEqual({ name, class: "write" })
    for (const name of ["restore_initiative_label", "restore_issue_label", "restore_project_label"]) expect({ name, class: classOf.get(name) }).toEqual({ name, class: "write" })
    // A save, a share, a comment and an upload are writes.
    for (const name of ["save_issue", "save_comment", "share_issue", "unshare_issue", "create_attachment", "whoami"]) expect({ name, class: classOf.get(name) }).toEqual({ name, class: "write" })
    expect(DESTRUCTIVE_TOOLS).toEqual(["delete_attachment", "delete_comment", "delete_diff_comment", "delete_status_update", "merge_diff"])
  })

  test("no unknown tool is a method", () => {
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(METHODS.map((method) => method.name)).not.toContain(name)
  })

  test("names Linear's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.linear")
    expect(NEXT_STEPS.SESSION_UNKNOWN).toContain("x-opencode-directory")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })
})
