import { describe, expect, test } from "bun:test"
import { classify, READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

describe("classify", () => {
  test("knows Linear's 42 reads and 36 writes, each once and in one list only", () => {
    expect(READ_TOOLS).toHaveLength(42)
    expect(WRITE_TOOLS).toHaveLength(36)
    expect(new Set([...READ_TOOLS, ...WRITE_TOOLS]).size).toBe(78)
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
  })

  test("reads never change anything: no save, create, delete, update or upload tool is a read", () => {
    expect(READ_TOOLS.filter((tool) => /^(save|create|delete|update|prepare|mark|merge|resolve|submit|share|unshare|retire|restore)_/.test(tool))).toEqual([])
  })

  test("treats everything else as unknown", () => {
    for (const tool of ["create_issue", "shiny_new_tool", "linear_list_issues", "LIST_ISSUES", ""]) expect(classify(tool)).toBe("unknown")
  })
})
