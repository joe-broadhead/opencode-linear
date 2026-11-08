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

describe("docs", () => {
  test.each(FILES)("%s states the current number of read and write tools", (file) => {
    const reads = [...text(file).matchAll(/\b(\d+) (?:known )?read(?:s| tools)\b/g)].map((match) => Number(match[1]))
    const writes = [...text(file).matchAll(/\b(\d+) (?:known )?write(?:s| tools)\b/g)].map((match) => Number(match[1]))
    expect(reads.filter((count) => count !== READ_TOOLS.length)).toEqual([])
    expect(writes.filter((count) => count !== WRITE_TOOLS.length)).toEqual([])
  })

  test.each(FILES)("%s names only Linear tools the plugin knows, and its own linear_issues", (file) => {
    const named = [...text(file).matchAll(/\blinear_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...WRITE_TOOLS, "issues"].includes(tool))).toEqual([])
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout linear` finds no server, and each access keeps its own
  // sign-in: the README signs out of both first, then removes the plugin.
  test("the README's Uninstall signs out of both accesses before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/.exec(text("README.md"))?.[1] ?? ""
    const at = (needle: string, from = 0) => uninstall.indexOf(needle, from)
    const first = at("opencode mcp logout linear")
    const other = at('"access"', first)
    const second = at("opencode mcp logout linear", other)
    expect([first, other, second].every((index) => index >= 0)).toBe(true)
    expect(at("opencode reload", other)).toBeLessThan(second)
    expect(at("opencode auth list", second)).toBeGreaterThan(second)
    expect(at("opencode plugin remove @joe-broadhead/opencode-linear")).toBeGreaterThan(at("opencode auth list", second))
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
