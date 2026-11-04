import { describe, expect, test } from "bun:test"
import { classify, READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { READ_ONLY_SERVER_TOOLS } from "./linear-catalog.js"

describe("classify", () => {
  test("knows Linear's 41 reads and 36 writes, each once and in one list only", () => {
    expect(READ_TOOLS).toHaveLength(41)
    expect(WRITE_TOOLS).toHaveLength(36)
    expect(new Set([...READ_TOOLS, ...WRITE_TOOLS]).size).toBe(77)
    for (const tool of READ_TOOLS) expect(classify(tool)).toBe("read")
    for (const tool of WRITE_TOOLS) expect(classify(tool)).toBe("write")
  })

  test("the known reads are exactly what Linear's read-only server lists", () => {
    expect([...READ_TOOLS].sort()).toEqual([...READ_ONLY_SERVER_TOOLS].sort())
    expect(WRITE_TOOLS.filter((tool) => READ_ONLY_SERVER_TOOLS.includes(tool))).toEqual([])
  })

  test("reads never change anything: no save, create, delete, update or upload tool is a read", () => {
    expect(READ_TOOLS.filter((tool) => /^(save|create|delete|update|prepare|mark|merge|resolve|submit|share|unshare|retire|restore)_/.test(tool))).toEqual([])
  })

  test("treats everything else as unknown, including whoami, which Linear no longer serves", () => {
    for (const tool of ["create_issue", "shiny_new_tool", "linear_list_issues", "LIST_ISSUES", "whoami", ""]) expect(classify(tool)).toBe("unknown")
  })
})
