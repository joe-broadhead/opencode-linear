import { describe, expect, test } from "bun:test"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { parseOptions } from "../../src/options.js"
import { defaultRules, evaluate, type Rule } from "../../src/permissions.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, readPackage } from "../support/jelly-kit.js"

const ISSUES_ACTION = "linear_issues"
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly writes each declared
 * "ask" as that tool's default (its agents have no base allow rule, so this plugin's own rules never reach them),
 * shows a declared view, and feeds Home only from a declared read-only tool. The shared kit checks the declaration
 * against Jelly's plugin authors' standard; the tests below add what only Linear declares.
 */

const ROOT = new URL("../../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & {
  tools: DeclaredTool[]
  views: { tools?: string[]; card?: { template: string } }[]
  contributes: { settings: { key: string; type: string; default: unknown }[]; homeFeeds: { label: string; description: string; feed: { title: string; tools: string[]; script: string } }[] }
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  test("declares the flat access option", () => {
    expect(jelly.contributes.settings.map(({ key, type }) => ({ key, type }))).toEqual([{ key: "access", type: "string" }])
    expect(parseOptions({ access: "read-only" }).access).toBe("read-only")
    expect(jelly.contributes.settings[0]?.default).toBe(parseOptions({}).access)
  })
  test("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: (permission) => evaluate([BASE_ALLOW, ...defaultRules()], permission) })).toEqual([])
  })

  test("declares every Linear tool as allowed, the reads as reads", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`linear_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of WRITE_TOOLS) expect(byPermission.get(`linear_${tool}`)).toMatchObject({ effect: "allow", readOnly: false })
    expect(byPermission.get(ISSUES_ACTION)).toMatchObject({ name: "linear.issues", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length + 1)
    // Exactly the known tools: none Linear no longer serves, such as whoami.
    expect([...byPermission.keys()].sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].map((tool) => `linear_${tool}`).concat(ISSUES_ACTION).sort())
  })

  test("draws linear_issues with Jelly's table card", () => {
    expect(jelly.views).toEqual([expect.objectContaining({ place: "tool-result", tools: ["linear_issues"], card: { template: "table" } })])
  })

  test("feeds Home only from a declared read", () => {
    const reads = new Set(jelly.tools.filter((tool) => tool.readOnly).map((tool) => tool.name))
    for (const preset of jelly.contributes.homeFeeds) for (const tool of preset.feed.tools) expect(reads.has(tool)).toBe(true)
  })


  test("describes the Home feed as what linear_issues returns: assigned issues in any state", () => {
    const [feed] = jelly.contributes.homeFeeds
    expect(feed?.feed.script).toContain("tools.linear.issues({})")
    // linear_issues asks list_issues for assignee "me" with no state filter, so done issues are listed too.
    for (const words of [feed?.label, feed?.description, feed?.feed.title]) expect(words).not.toMatch(/unfinished|open|active|in progress/i)
  })
})

describe("docs/jelly.md", () => {
  test("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
