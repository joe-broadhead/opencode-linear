// The docs and skills state the tool counts and list the tools RPC's methods. They must match src/linear-tools.ts, so
// a change to the tool lists cannot leave a stale count or method behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release. CHANGELOG keeps the counts of past releases.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")

/** The release the install specs name: package.json's version. */
const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version
/** The README's upgrade example removes an earlier release's entry; it must name one before VERSION. */
const UPGRADE_FROM = /remove the old entry with `opencode plugin remove github:joe-broadhead\/opencode-linear#v(\d+)\.(\d+)\.(\d+)`/

describe("docs", () => {
  test.each(FILES)("%s states the current number of read and write tools", (file) => {
    const reads = [...text(file).matchAll(/\b(\d+) (?:known )?read(?:s| tools)\b/g)].map((match) => Number(match[1]))
    const writes = [...text(file).matchAll(/\b(\d+) (?:known )?write(?:s| tools)\b/g)].map((match) => Number(match[1]))
    expect(reads.filter((count) => count !== READ_TOOLS.length)).toEqual([])
    expect(writes.filter((count) => count !== WRITE_TOOLS.length)).toEqual([])
  })

  test.each(FILES)("%s names only Linear tools the plugin knows, and its own linear_issues and linear_events_list", (file) => {
    const named = [...text(file).matchAll(/\blinear_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...WRITE_TOOLS, "issues", "events_list"].includes(tool))).toEqual([])
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout linear` finds no server: the README signs out first,
  // once, since every access uses the one sign-in, then removes the plugin.
  test("the README's Uninstall signs out once before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/s.exec(text("README.md"))?.[1] ?? ""
    const at = (needle: string, from = 0) => uninstall.indexOf(needle, from)
    const logout = at("opencode mcp logout linear")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(at('"access"')).toBe(-1)
    expect(at("opencode auth list", logout)).toBeGreaterThan(logout)
    expect(at(`opencode plugin remove github:joe-broadhead/opencode-linear#v${VERSION}`)).toBeGreaterThan(at("opencode auth list", logout))
  })

  test("the README and the configuration guide give linear_issues its allow rule and say why it is a direct tool", () => {
    for (const file of ["README.md", "docs/configuration.md"]) {
      expect(text(file)).toContain('{ "action": "linear_issues", "resource": "*", "effect": "allow" }')
      expect(text(file)).toMatch(/direct tool.*Jelly/)
    }
  })

  test("the Jelly guide states the declared tool counts, and no placeholder or version", () => {
    const tools = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).jelly.tools as { readOnly: boolean }[]
    expect(text("docs/jelly.md")).toContain(`${tools.length} tools are declared (${tools.filter((tool) => tool.readOnly).length} read-only)`)
    expect(text("docs/jelly.md")).not.toMatch(/`latest` is|None yet/)
    expect(text("docs/jelly.md")).toContain("the one line in `jelly.summary`, and beside it the mark in `jelly.icon`")
  })

  test("the scripting guide says the methods are every known tool, and names the reads and writes as one table", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`METHODS` in `src/host/tools-rpc.ts`)")
    expect(guide).toContain(`${READ_TOOLS.length} reads and the ${WRITE_TOOLS.length}`)
    expect(guide).toContain("`issues`")
    expect(guide).toContain("x-opencode-directory")
  })
})

describe("the upgrade example", () => {
  test("removes an earlier release than the one the install specs name", () => {
    const match = UPGRADE_FROM.exec(text("README.md"))
    expect(match).not.toBeNull()
    const earlier = match!.slice(1, 4).map(Number)
    const current = VERSION.split(".").map(Number)
    const order = earlier.map((part, index) => part - current[index]!).find((difference) => difference !== 0) ?? 0
    expect(order).toBeLessThan(0)
  })
})
