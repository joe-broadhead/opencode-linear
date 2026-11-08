// Linear's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as LINEAR_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { defaultRules } from "../../src/permissions.js"

const ISSUES_ACTION = "linear_issues"
const EVENTS_ACTION = "linear_events_list"

describe("Linear's tools RPC", () => {
  test("is linear.workspace.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(LINEAR_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("linear.workspace.tools")
  })

  test("its MCP methods are exactly the 41 known reads, the server tools the default rules allow", () => {
    expect([...KNOWN_READS]).toEqual([...READ_TOOLS])
    expect(KNOWN_READS).toHaveLength(41)
    // The plugin's own two reads are allowed too: linear_issues as a tool only, never a method, and
    // linear_events_list as a tool and the owned method events_list, registered in setup.
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed.filter((action) => action !== ISSUES_ACTION && action !== EVENTS_ACTION))
    expect(allowed).toContain(ISSUES_ACTION)
    expect(allowed).toContain(EVENTS_ACTION)
    expect(KNOWN_READS).not.toContain("issues")
    expect(KNOWN_READS).not.toContain("events_list")
  })

  test("no known write and no unknown tool is a method", () => {
    expect(WRITE_TOOLS).toHaveLength(36)
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name))).toEqual([])
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
  })

  test("names Linear's own commands in its next steps, and has no per-account servers", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.linear")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })
})
