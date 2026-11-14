import { describe, expect, test } from "bun:test"
import { parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults to read access on a tested host", () => {
    expect(parseOptions(undefined)).toEqual({ access: "all", allowUntestedHost: false })
    expect(parseOptions({})).toEqual({ access: "all", allowUntestedHost: false })
  })

  test("accepts every documented value", () => {
    expect(parseOptions({ access: "all" })).toEqual({ access: "all", allowUntestedHost: false })
    expect(parseOptions({ access: "read-only", allowUntestedHost: true })).toEqual({ access: "read-only", allowUntestedHost: true })
  })

  test("maps the deprecated values onto the family's, and keeps the sign-in", () => {
    expect(parseOptions({ access: "read" })).toMatchObject({ access: "read-only", deprecation: 'The access value "read" is deprecated: it means "read-only". Set "read-only".' })
    expect(parseOptions({ access: "write" })).toMatchObject({ access: "all" })
  })

  test.each(["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"])("refuses %j, an inherited name and not an access value", (access) => {
    expect(() => parseOptions({ access })).toThrow(`The option "access" must be "all" (the default), "ask-changes" or "read-only", found "${access}"`)
  })

  test.each([
    [{ account: "work" }, 'Unknown option "account". Accepted options: "access", "allowUntestedHost"'],
    [{ allowTools: ["create_issue"] }, 'Unknown option "allowTools"'],
    [{ access: "admin" }, 'The option "access" must be "all" (the default), "ask-changes" or "read-only", found "admin"'],
    [{ access: ["read"] }, 'The option "access" must be "all" (the default), "ask-changes" or "read-only", found an array'],
    [{ allowUntestedHost: "yes" }, 'The option "allowUntestedHost" must be true or false (the default), found "yes"'],
    [{ allowUntestedHost: null }, 'The option "allowUntestedHost" must be true or false (the default), found null'],
    ["read", "The plugin options must be an object, found \"read\""],
    [[], "The plugin options must be an object, found an array"],
  ])("rejects %j with the key, the accepted values and an example", (input, problem) => {
    expect(() => parseOptions(input)).toThrow(problem)
    try {
      parseOptions(input)
    } catch (error) {
      const { message, code, nextStep } = error as Error & { code: string; nextStep: string }
      expect(code).toBe("OPTIONS_INVALID")
      expect(message.startsWith("OPTIONS_INVALID: ")).toBe(true)
      expect(nextStep).toContain(`"options": { "access": "read-only" }`)
      expect(message.endsWith(`. Next step: ${nextStep}`)).toBe(true)
      expect(nextStep.endsWith(".")).toBe(true)
    }
  })
})
