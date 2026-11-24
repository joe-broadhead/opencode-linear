// The docs and skills state the tool counts and list the tools RPC's methods. They must match src/linear-tools.ts, so
// a change to the tool lists cannot leave a stale count or method behind.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
// Everything a user or the model reads about the current release.
const FILES = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  ...readdirSync(join(ROOT, "docs")).map((name) => `docs/${name}`),
  ...readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`),
]
const text = (file: string) => readFileSync(join(ROOT, file), "utf8").replace(/\s+/g, " ")
const VERSION = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version

describe("docs", () => {
  test.each(FILES)("%s states the current number of read and write tools", (file) => {
    const reads = [...text(file).matchAll(/\b(\d+) (?:known )?read(?:s| tools)\b/g)].map((match) => Number(match[1]))
    const writes = [...text(file).matchAll(/\b(\d+) (?:known )?write(?:s| tools)\b/g)].map((match) => Number(match[1]))
    expect(reads.filter((count) => count !== READ_TOOLS.length)).toEqual([])
    expect(writes.filter((count) => count !== WRITE_TOOLS.length)).toEqual([])
  })

  test.each(FILES)("%s names only Linear tools the plugin knows, its own linear_issues and linear_events_list, and linear_probe", (file) => {
    const named = [...text(file).matchAll(/\blinear_([a-z][a-z_]*)(?![\w*])/g)].map((match) => match[1]!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...WRITE_TOOLS, "issues", "events_list", "probe"].includes(tool))).toEqual([])
  })

  test.each(FILES)("%s points at the new organisation and has no removed app guide", (file) => {
    expect(text(file)).not.toMatch(/joe-broadhead|opencode-linear|docs\/jelly\.md/)
  })

  // Once the plugin is removed and OpenCode reloads, `mcp logout linear` finds no server: the README signs out first,
  // once, since every access uses the one sign-in, then removes the plugin.
  test("the README's Uninstall signs out once before it removes the plugin", () => {
    const uninstall = /## Uninstall(.*?)## Links/s.exec(text("README.md"))?.[1] ?? ""
    const at = (needle: string, from = 0) => uninstall.indexOf(needle, from)
    const logout = at("opencode mcp logout linear")
    expect(logout).toBeGreaterThanOrEqual(0)
    expect(at('"access"')).toBe(-1)
    expect(at("opencode plugin remove github:we-the-rebel-alliance/linear-plugin#v<version>")).toBeGreaterThan(logout)
  })

  test("the configuration guide gives linear_issues its allow rule, and both it and the README place it in Code Mode", () => {
    expect(text("docs/configuration.md")).toContain('{ "action": "linear_issues", "resource": "*", "effect": "allow" }')
    for (const file of ["README.md", "docs/configuration.md"]) expect(text(file)).toMatch(/Code Mode/)
  })

  test("the scripting guide says the methods are every known tool, and names the reads and writes as one table", () => {
    const guide = text("docs/scripting.md")
    expect(guide).toContain("(`METHODS` in `src/tools-rpc.ts`)")
    expect(guide).toContain(`${READ_TOOLS.length} reads and the ${WRITE_TOOLS.length}`)
    expect(guide).toContain("`issues`")
    expect(guide).toContain("x-opencode-directory")
  })

  test("every install spec names the new package and a release tag, never an untagged repository", () => {
    const specs = FILES.flatMap((file) =>
      [...text(file).matchAll(/github:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(#(?:v\d+\.\d+\.\d+|v<(?:old )?version>))?/g)].map((match) => ({ file, repo: match[1]!, tag: match[2] ?? "" })),
    )
    expect(specs.length).toBeGreaterThan(0)
    // Until v0.0.0 is cut, the install examples use the placeholder; a concrete tag must be the current version.
    expect(specs.some((spec) => spec.tag === "#v<version>")).toBe(true)
    for (const spec of specs) {
      expect({ file: spec.file, repo: spec.repo }).toEqual({ file: spec.file, repo: "we-the-rebel-alliance/linear-plugin" })
      expect(spec.tag).toMatch(/^#(?:v\d+\.\d+\.\d+|v<(?:old )?version>)$/)
    }
    for (const spec of specs.filter((spec) => /^#v\d/.test(spec.tag))) expect(spec.tag).toBe(`#v${VERSION}`)
  })
})
