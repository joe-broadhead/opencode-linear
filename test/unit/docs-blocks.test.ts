// The docs print what the code does: the generated default block, in full, for every access value, and the tested
// OpenCode release in every sentence that says something is tested. A change to either cannot leave a doc behind.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { TESTED_HOSTS } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

/** The first ```json block that follows the markdown matched by `after`, or `[]` when there is none. */
function blockAfter(text: string, after: string | RegExp): unknown {
  const index = typeof after === "string" ? text.indexOf(after) : (after.exec(text)?.index ?? -1)
  const start = index === -1 ? -1 : text.indexOf("```json", index)
  if (start === -1) return []
  const end = text.indexOf("```", start + 7)
  return end === -1 ? [] : JSON.parse(text.slice(start + 7, end))
}

// R7: an administrator copies these blocks into managed config, so each must be the plugin's real block, in full.
describe("the default rules block", () => {
  const CONFIGURATION = read("docs/configuration.md")

  test.each(["all", "ask-changes", "read-only"] as const)("the configuration guide prints the %s block in full", (access) => {
    const printed = blockAfter(CONFIGURATION, new RegExp(`^\`access: "${access}"\``, "m"))
    expect(printed).toEqual(defaultRules(access))
  })

  test("every access value's block differs from the others", () => {
    expect(JSON.stringify(defaultRules("all"))).not.toBe(JSON.stringify(defaultRules("ask-changes")))
    expect(JSON.stringify(defaultRules("ask-changes"))).not.toBe(JSON.stringify(defaultRules("read-only")))
  })
})

// R8: a release added to the list cannot leave a stale "tested on …" sentence behind.
describe("tested hosts", () => {
  // The newest release's section: the pending notes until a release, and the latest one after it.
  const NEWEST = /## \[?[^\]\n]+\]?[^\n]*\n([\s\S]*?)(?=\n## |$)/.exec(read("CHANGELOG.md"))?.[1] ?? ""
  const SOURCES: [string, string][] = [
    ["README.md", read("README.md")],
    ["AGENTS.md", read("AGENTS.md")],
    ["SECURITY.md", read("SECURITY.md")],
    ["docs/configuration.md", read("docs/configuration.md")],
    ["CHANGELOG.md (newest release)", NEWEST],
  ]

  test.each(SOURCES)("%s names exactly TESTED_HOSTS wherever it says what is tested", (file, text) => {
    const mentions = text
      .split("\n")
      .flatMap((line) => line.split(/\.\s+/))
      .filter((sentence) => /\btested\b/i.test(sentence))
      // The supported range is not a tested release: drop a backticked `>=a.b.c <d.e.f` span before reading versions.
      .map((sentence) => sentence.replace(/`[^`]*>=[^`]*`/g, ""))
      .map((sentence) => [...sentence.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((version) => version[0]!))
      .filter((versions) => versions.length > 0)
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  test("the README's Requirements line names every tested release", () => {
    const requirements = /## Requirements([\s\S]*?)## /i.exec(read("README.md"))?.[1] ?? ""
    const named = [...requirements.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).filter((version) => version !== "2.5.0")
    expect([...new Set(named)].sort()).toEqual([...TESTED_HOSTS].sort())
  })

  // Two examples: 2.4.99 is inside the range and never ships, and 2.5.0 is the first release outside it.
  test("the untested example inside the range is 2.4.99, and 2.5.0 is the example outside it", () => {
    const all = SOURCES.map(([, text]) => text).join("\n")
    expect(all).toContain("2.4.99")
    expect(all).toContain("2.5.0")
    // Every other 2.4 or 2.5 release a doc names is one the checks run on.
    const named = [...new Set([...all.matchAll(/\b2\.[45]\.\d+\b/g)].map((match) => match[0]!))]
    expect(named.filter((version) => version !== "2.4.99" && version !== "2.5.0" && !TESTED_HOSTS.includes(version))).toEqual([])
  })
})
