// The shipped skills: exactly two, loadable by the plugin, short, free of internal jargon, and naming only Linear
// tools the plugin knows.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"
import { parseSkill, SKILLS_DIR } from "../../src/skills.js"

const NAMES = ["linear", "linear-write"]
const MAX_LINES = 120
// Words from the plugin's own process and the old implementation that mean nothing to the model or the user.
const JARGON = /manifest|attest|quarantin|evidence|acceptance|harness|fixture|\bfork\b|dispatch|lease|catalog|allowlist|reviewed|capabilit|linear_internal|\bWS-[A-Z0-9]|PLAN\.md|drift|preview|\bTODO\b/i

const read = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8")

describe("skills", () => {
  test("exactly the two skills, each a single SKILL.md", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual(NAMES)
    for (const name of NAMES) expect(readdirSync(join(SKILLS_DIR, name))).toEqual(["SKILL.md"])
  })

  test.each(NAMES)("%s loads, is named after its folder and has a one-line description", (name) => {
    const text = read(name)
    const skill = parseSkill(name, join(SKILLS_DIR, name, "SKILL.md"), text)
    expect(skill.name as string).toBe(name)
    expect(skill.description?.length).toBeGreaterThan(40)
    expect(text.split("\n").filter((line) => line.startsWith("description:"))).toHaveLength(1)
    expect(skill.content.length).toBeGreaterThan(0)
  })

  test.each(NAMES)("%s is under the line limit and free of internal jargon", (name) => {
    const text = read(name)
    expect(text.split("\n").length).toBeLessThan(MAX_LINES)
    expect(text.match(JARGON)?.[0]).toBeUndefined()
  })

  test.each(NAMES)("%s names only Linear tools the plugin knows", (name) => {
    const named = [...read(name).matchAll(/\blinear_([a-z_]+)\b|\btools\.linear\.([a-z_]+)\b/g)].map((match) => (match[1] ?? match[2])!)
    expect(named.filter((tool) => ![...READ_TOOLS, ...WRITE_TOOLS].includes(tool))).toEqual([])
  })

  test("linear sends the user to /linear-status and the sign-in step when Linear is missing", () => {
    const text = read("linear")
    expect(text).toContain("/linear-status")
    expect(text).toContain("run `/connect` and choose Linear")
    expect(text).toContain("opencode mcp auth linear")
  })

  test("neither skill claims that read access hides the write tools", () => {
    for (const name of NAMES) expect(read(name)).not.toMatch(/hidden|hides|not visible/i)
  })
})
