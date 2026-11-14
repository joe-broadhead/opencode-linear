// Linear's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as LINEAR_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { METHODS, NEXT_STEPS, PLUGIN_ID, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { defaultRules } from "../../src/permissions.js"

const ISSUES_ACTION = "linear_issues"
const EVENTS_ACTION = "linear_events_list"

describe("Linear's tools RPC", () => {
  test("is linear.workspace.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(LINEAR_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("linear.workspace.tools")
  })

  test("its MCP methods are exactly the 41 known reads and the 37 other known tools, each with its class", () => {
    expect(METHODS.map((method) => method.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(METHODS.filter((method) => method.class === "read").map((method) => method.name)).toEqual([...READ_TOOLS])
    expect(METHODS.filter((method) => method.class === "write").map((method) => method.name)).toEqual([...WRITE_TOOLS])
    expect(READ_TOOLS).toHaveLength(41)
    expect(WRITE_TOOLS).toHaveLength(37)
    // Every known tool is allowed by default, the pattern that covers a tool Linear adds later included; the plugin's
    // own linear_issues is the owned method `issues`, not an MCP one.
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    // The reads, the plugin's own `issues` and `events_list`, then the writes: the block's order.
    expect(allowed).toEqual([`${SERVER_NAME}_*`, ...READ_TOOLS.map((name) => `${SERVER_NAME}_${name}`), ISSUES_ACTION, EVENTS_ACTION, ...WRITE_TOOLS.map((name) => `${SERVER_NAME}_${name}`)])
    expect(METHODS.map((method) => method.name)).not.toContain("issues")
    expect(METHODS.map((method) => method.name)).not.toContain("events_list")
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
