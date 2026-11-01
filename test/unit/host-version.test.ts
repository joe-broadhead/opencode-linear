import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { SUPPORTED_HOST } from "../../src/constants.js"
import { checkHost, isTestedHost } from "../../src/host-version.js"

describe("host guard", () => {
  test.each(["2.2.3", "2.2.4", "2.2.10"])("accepts %s", (version) => {
    expect(isTestedHost(version)).toBe(true)
    expect(checkHost(version, false)).toEqual({ version, tested: true })
  })

  test.each(["2.2.2", "2.3.0", "2.9.0", "3.0.0", "1.9.9", "2.2.4-beta.1", "0.0.0-dev-1", "unknown", "", "v2.2.3", "2.2"])(
    "refuses %j with the code, the version and the override",
    (version) => {
      expect(isTestedHost(version)).toBe(false)
      expect(() => checkHost(version, false)).toThrow(
        `HOST_UNTESTED: This plugin supports OpenCode ${SUPPORTED_HOST}, found ${version}. Next step: Install a plugin version made for your OpenCode, or set the plugin option allowUntestedHost: true to try anyway.`,
      )
    },
  )

  test("warns instead with allowUntestedHost", () => {
    const check = checkHost("2.3.0", true)
    expect(check).toMatchObject({ version: "2.3.0", tested: false })
    expect(check.warning).toContain("OpenCode 2.3.0 is outside the tested line >=2.2.3 <2.3.0")
  })

  test("the supported range is the package's opencode.host", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    expect(pkg.opencode.host).toBe(SUPPORTED_HOST)
  })
})
