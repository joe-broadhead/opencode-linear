// The fixed-context budget (the plugin standard, §0 rule 4): one namespace line of at most 400 characters, skill
// descriptions of at most 300, nothing pinned and no per-request hook. A change that spends more fixed context on
// every turn fails here.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"
import { NAMESPACE_DESCRIPTION } from "../../src/constants.js"
import { parseSkill, SKILLS_DIR } from "../../src/skills.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const NAMESPACE_LIMIT = 400
const SKILL_LIMIT = 300
const SKILLS = readdirSync(SKILLS_DIR).sort()

describe("the fixed-context budget", () => {
  test("the namespace line is one line of at most 400 characters", () => {
    expect([...NAMESPACE_DESCRIPTION].length).toBeLessThanOrEqual(NAMESPACE_LIMIT)
    expect(NAMESPACE_DESCRIPTION).not.toContain("\n")
  })

  test.each(SKILLS)("skills/%s's description is at most 300 characters", (name) => {
    const skill = parseSkill(name, join(SKILLS_DIR, name, "SKILL.md"), readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8"))
    expect([...(skill.description ?? "")].length).toBeLessThanOrEqual(SKILL_LIMIT)
  })

  test("nothing is pinned and no per-request hook is registered", () => {
    for (const file of readdirSync(join(ROOT, "src"))) {
      const text = readFileSync(join(ROOT, "src", file), "utf8")
      expect({ file, pinned: /\bpinned\s*:\s*true\b/.test(text), hook: /\bctx\.hook\b|\bsession\.hook\b|\b(?:context|prompt|compaction|experimental\.idle)\s*:\s*\(/i.test(text) }).toEqual({ file, pinned: false, hook: false })
    }
  })
})
