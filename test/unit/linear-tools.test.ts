import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { classify, READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

/** Linear's tool list, captured live: test/fixtures/live-tools.json. */
const live: { name: string; readOnlyHint: boolean }[] = JSON.parse(readFileSync(new URL("../fixtures/live-tools.json", import.meta.url), "utf8")).tools

describe("classify", () => {
  test("knows Linear's 41 reads and 37 other tools, each once and in one list only", () => {
    expect(READ_TOOLS).toHaveLength(41)
    expect(WRITE_TOOLS).toHaveLength(37)
    expect(new Set([...READ_TOOLS, ...WRITE_TOOLS]).size).toBe(78)
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
  })

  test("the known reads are exactly the tools Linear marks read-only, and the rest exactly the others", () => {
    expect([...READ_TOOLS].sort()).toEqual(live.filter((tool) => tool.readOnlyHint).map((tool) => tool.name).sort())
    expect([...WRITE_TOOLS].sort()).toEqual(live.filter((tool) => !tool.readOnlyHint).map((tool) => tool.name).sort())
  })

  test("reads never change anything: no save, create, delete, update or upload tool is a read", () => {
    expect(READ_TOOLS.filter((tool) => /^(save|create|delete|update|prepare|mark|merge|resolve|submit|share|unshare|retire|restore)_/.test(tool))).toEqual([])
  })

  test("treats everything else as unknown", () => {
    for (const tool of ["create_issue", "shiny_new_tool", "linear_list_issues", "LIST_ISSUES", ""]) expect(classify(tool)).toBe("unknown")
  })
})
