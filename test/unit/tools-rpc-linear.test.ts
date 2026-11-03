// Linear's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts. The shared part is tested in
// tools-rpc.test.ts.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as LINEAR_PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { KNOWN_READS, NEXT_STEPS, PLUGIN_ID, pluginError, shapeResult, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { defaultRules } from "../../src/permissions.js"

describe("Linear's tools RPC", () => {
  test("is linear.workspace.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(LINEAR_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("linear.workspace.tools")
  })

  test("its methods are exactly the 42 known reads, the tools the default rules allow", () => {
    expect([...KNOWN_READS]).toEqual([...READ_TOOLS])
    expect(KNOWN_READS).toHaveLength(42)
    const allowed = defaultRules().filter((rule) => rule.effect === "allow").map((rule) => rule.action)
    expect(KNOWN_READS.map((name) => `${SERVER_NAME}_${name}`)).toEqual(allowed)
  })

  test("no known write and no unknown tool is a method", () => {
    expect(WRITE_TOOLS).toHaveLength(36)
    expect(KNOWN_READS.filter((name) => WRITE_TOOLS.includes(name))).toEqual([])
    for (const name of ["shiny_new_tool", "describe", "*"]) expect(KNOWN_READS).not.toContain(name)
  })

  test("returns Linear's results unchanged: the model path has no hook that changes them", () => {
    const result = { output: { issues: [] }, text: "text" }
    expect(shapeResult("list_issues", result)).toBe(result)
  })

  test("names Linear's own commands in its next steps, and has no per-account servers or own errors", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.linear")
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
    expect(pluginError(new Error("any"))).toBeUndefined()
  })
})
