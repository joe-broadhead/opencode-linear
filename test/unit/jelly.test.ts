import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

const ISSUES_ACTION = "linear_issues"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly writes each declared
 * "ask" as that tool's default (its agents have no base allow rule, so this plugin's own rules never reach them),
 * shows a declared view, and feeds Home only from a declared read-only tool.
 */

type Tool = { name: string; permission: string; effect: string; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[]
  jelly: { summary: string; icon: string }
}
// The drawing elements Jelly's icon cleaner keeps (hey-jelly `plugin-icon.ts`). It drops a whole icon that has any
// other element, so a `<title>` is refused too.
const ICON_ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs"])
for (const name of ["linearGradient", "radialGradient", "stop", "clipPath", "mask"]) ICON_ELEMENTS.add(name)
const jelly = (pkg as { jelly: unknown }).jelly as {
  tools: Tool[]
  skills: string[]
  views: { tools?: string[]; card?: { template: string } }[]
  contributes: { homeFeeds: { label: string; description: string; feed: { title: string; tools: string[]; script: string } }[] }
}
const byPermission = new Map(jelly.tools.map((tool) => [tool.permission, tool]))

describe("the jelly declaration", () => {
  test("declares Linear's reads as reads that run and its writes as writes that ask", () => {
    for (const tool of READ_TOOLS) expect(byPermission.get(`linear_${tool}`)).toMatchObject({ effect: "allow", readOnly: true })
    for (const tool of WRITE_TOOLS) expect(byPermission.get(`linear_${tool}`)).toMatchObject({ effect: "ask", readOnly: false })
    expect(byPermission.get(ISSUES_ACTION)).toMatchObject({ name: "linear.issues", effect: "allow", readOnly: true })
    expect(jelly.tools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length + 1)
    // Exactly the known tools: none Linear no longer serves, such as whoami.
    expect([...byPermission.keys()].sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].map((tool) => `linear_${tool}`).concat(ISSUES_ACTION).sort())
  })

  test("uses only the keys Jelly's declaration schema accepts, which refuses any other", () => {
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("draws linear_issues with Jelly's table card", () => {
    expect(jelly.views).toEqual([expect.objectContaining({ place: "tool-result", tools: ["linear_issues"], card: { template: "table" } })])
  })

  test("names every skill the package ships, and feeds Home only from a declared read", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
    const reads = new Set(jelly.tools.filter((tool) => tool.readOnly).map((tool) => tool.name))
    for (const preset of jelly.contributes.homeFeeds) for (const tool of preset.feed.tools) expect(reads.has(tool)).toBe(true)
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(pkg.jelly.summary.trim().length).toBeGreaterThan(0)
    expect(pkg.jelly.summary.length).toBeLessThanOrEqual(120)
    expect(pkg.jelly.summary).not.toContain("\n")
  })

  test("the icon is assets/icon.svg, shipped, with one svg root, xmlns and a 24 or 32 viewBox, only drawing elements, under 2 KB", () => {
    expect(pkg.jelly.icon).toBe("assets/icon.svg")
    expect(pkg.files).toContain(pkg.jelly.icon)
    const svg = readFileSync(new URL(`../../${pkg.jelly.icon}`, import.meta.url), "utf8").trim()
    expect(svg.length).toBeLessThan(2048)
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (24 24|32 32)"/)
    expect(svg.endsWith("</svg>")).toBe(true)
    expect(svg).not.toMatch(/<title|<style|<script|&|<!/i)
    const elements = [...svg.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1])
    expect(elements.filter((name) => !ICON_ELEMENTS.has(name!))).toEqual([])
  })

  test("describes the Home feed as what linear_issues returns: assigned issues in any state", () => {
    const [feed] = jelly.contributes.homeFeeds
    expect(feed?.feed.script).toContain("tools.linear.issues({})")
    // linear_issues asks list_issues for assignee "me" with no state filter, so done issues are listed too.
    for (const words of [feed?.label, feed?.description, feed?.feed.title]) expect(words).not.toMatch(/unfinished|open|active|in progress/i)
  })
})
