import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSkills, parseSkill, registerSkills, SKILLS_DIR, skillNames } from "../../src/skills.js"

const root = mkdtempSync(join(tmpdir(), "linear-skill-loading-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function skills(files: Record<string, string>) {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

describe("skill loading", () => {
  test("linear always, linear-write only with write access", () => {
    expect(skillNames("read-only")).toEqual(["linear"])
    expect(skillNames("all")).toEqual(["linear", "linear-write"])
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills/")).toBe(true)
  })

  test("parses LF and CRLF frontmatter into a skill", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = ["---", "name: linear", 'description: "Use Linear: find, read and cite issues."', "---", "", "# Linear", "Body."].join(newline)
      expect(parseSkill("linear", "/pkg/skills/linear/SKILL.md", text)).toEqual({
        id: "linear",
        name: "linear",
        description: "Use Linear: find, read and cite issues.",
        path: "/pkg/skills/linear/SKILL.md",
        content: "# Linear\nBody.",
      } as never)
    }
  })

  test.each([
    ["no frontmatter", "# Linear", "skills/linear/SKILL.md has no frontmatter"],
    ["the wrong name", "---\nname: other\ndescription: d\n---\n", 'skills/linear/SKILL.md must be named "linear" in its frontmatter'],
    ["no description", "---\nname: linear\n---\n", "skills/linear/SKILL.md has no description"],
  ])("rejects a skill with %s", (_, text, message) => {
    expect(() => parseSkill("linear", "/x", text)).toThrow(message)
  })

  test("loads the skills for the access mode", async () => {
    const ok = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`
    const directory = skills({ linear: ok("linear"), "linear-write": ok("linear-write") })
    const ids = (loaded: Awaited<ReturnType<typeof loadSkills>>) => loaded.skills.map((skill): string => skill.id)
    expect(ids(await loadSkills("read-only", directory))).toEqual(["linear"])
    const write = await loadSkills("all", directory)
    expect(ids(write)).toEqual(["linear", "linear-write"])
    expect(write.problems).toEqual([])
  })

  test("a missing or broken skill becomes a problem for status, not a setup failure", async () => {
    const directory = skills({ linear: "---\nname: linear\n---\n" })
    expect(await loadSkills("all", directory)).toEqual({
      skills: [],
      problems: [
        'SKILLS_INVALID: The "linear" skill was not loaded: skills/linear/SKILL.md has no description. Next step: Reinstall the plugin.',
        'SKILLS_INVALID: The "linear-write" skill was not loaded: skills/linear-write/SKILL.md is missing. Next step: Reinstall the plugin.',
      ],
    })
  })

  test("an unreadable skill file is reported as unreadable, not missing", async () => {
    const directory = skills({})
    mkdirSync(join(directory, "linear", "SKILL.md"), { recursive: true })
    expect((await loadSkills("read-only", directory)).problems).toEqual([
      'SKILLS_INVALID: The "linear" skill was not loaded: skills/linear/SKILL.md cannot be read (EISDIR). Next step: Reinstall the plugin.',
    ])
  })

  test("registers every loaded skill", async () => {
    const added: string[] = []
    await registerSkills(
      { transform: async (callback) => (callback({ add: (skill: { id: string }) => void added.push(skill.id) } as never), { dispose: async () => {} }) },
      [parseSkill("linear", "/x", "---\nname: linear\ndescription: d\n---\n")],
    )
    expect(added).toEqual(["linear"])
  })
})
