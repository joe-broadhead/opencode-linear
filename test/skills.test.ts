/**
 * The skills loader: the package's two skills, the frontmatter rules, and the promise that a broken file becomes a
 * `status` problem instead of a setup failure.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { loadSkills, parseSkill, registerSkills, SKILLS_DIR, skillNames } from "../src/skills.ts"

const root = mkdtempSync(join(tmpdir(), "linear-skills-"))
after(() => rmSync(root, { recursive: true, force: true }))

/** A temp `skills/` folder holding one folder per entry. */
function skills(files: Readonly<Record<string, string>>, extra: readonly string[] = []): string {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  for (const name of extra) writeFileSync(join(directory, name), "")
  return directory
}

const skillText = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n\nBody.\n`

test("the package ships linear and linear-write, each with a description and content", async () => {
  const loaded = await loadSkills()
  assert.deepEqual(loaded.problems, [])
  assert.deepEqual(
    loaded.skills.map((skill) => skill.id),
    ["linear", "linear-write"],
  )
  for (const skill of loaded.skills) {
    assert.equal(skill.name, skill.id)
    assert.equal(skill.path, join(SKILLS_DIR, String(skill.id), "SKILL.md"))
    assert.ok((skill.description ?? "").length > 40, `${skill.id} has a short description`)
    assert.ok(skill.content.length > 0, `${skill.id} has no content`)
    // The folded `description: >` block becomes one line, not the marker alone.
    assert.ok(!skill.description?.includes(">"))
    assert.ok(!skill.description?.includes("\n"))
  }
})

test("parses LF and CRLF frontmatter, a folded description and a literal block", () => {
  for (const newline of ["\n", "\r\n"]) {
    const text = ["---", "name: linear", "description: >", "  Use Linear: find,", "  read and cite issues.", "---", "", "# Linear", "Body."].join(newline)
    const skill = parseSkill("linear", "/pkg/skills/linear/SKILL.md", text)
    assert.equal(skill.id, "linear")
    assert.equal(skill.name, "linear")
    assert.equal(skill.description, "Use Linear: find, read and cite issues.")
    assert.equal(skill.content, "# Linear\nBody.")
  }
  const literal = parseSkill("linear", "/x", "---\nname: linear\ndescription: |\n  one\n  two\n---\nBody\n")
  assert.equal(literal.description, "one\ntwo")
})

test("quoted frontmatter values are unquoted", () => {
  assert.equal(parseSkill("linear", "/x", '---\nname: "linear"\ndescription: "A description."\n---\nBody\n').description, "A description.")
})

test("rejects a wrong name, a missing description and empty content with SKILLS_INVALID", () => {
  assert.throws(() => parseSkill("linear", "/x", "# Linear"), /SKILLS_INVALID: The "linear" skill was not loaded: skills\/linear\/SKILL\.md has no frontmatter\. Next step:/)
  assert.throws(() => parseSkill("linear", "/x", "---\nname: other\ndescription: d\n---\nBody\n"), /must be named "linear" in its frontmatter/)
  assert.throws(() => parseSkill("linear", "/x", "---\nname: linear\n---\nBody\n"), /has no description/)
  assert.throws(() => parseSkill("linear", "/x", "---\nname: linear\ndescription: d\n---\n"), /has no content/)
})

test("skips folders without a SKILL.md and a stray file, and lists the rest sorted", async () => {
  const directory = skills({ beta: skillText("beta"), alpha: skillText("alpha") }, ["README.md"])
  mkdirSync(join(directory, "empty"))
  assert.deepEqual((await loadSkills(directory)).skills.map((skill) => skill.id), ["alpha", "beta"])
  assert.deepEqual(await skillNames(directory), ["alpha", "beta"])
})

test("a broken or missing skill is a problem for status, not a failed load", async () => {
  const directory = skills({ linear: "---\nname: linear\n---\n", "linear-write": skillText("linear-write") })
  const loaded = await loadSkills(directory)
  assert.deepEqual(
    loaded.skills.map((skill) => skill.id),
    ["linear-write"],
  )
  assert.deepEqual(loaded.problems, ['SKILLS_INVALID: The "linear" skill was not loaded: skills/linear/SKILL.md has no description. Next step: Reinstall the plugin from its release tag, or reinstall the version tag you installed.'])
})

test("a missing skills folder is one status problem, not a throw", async () => {
  const loaded = await loadSkills(join(root, "absent"))
  assert.deepEqual(loaded.skills, [])
  assert.equal(loaded.problems.length, 1)
  assert.match(loaded.problems[0] ?? "", /^SKILLS_INVALID: The plugin's skills were not loaded: the skills\/ folder is missing\. Next step: /)
})

test("registerSkills adds every loaded skill and returns the transform registration", async () => {
  const added: string[] = []
  let disposed = 0
  const registration = await registerSkills(
    {
      transform: async (callback: (editor: { add(skill: { id: string }): void }) => void) => {
        callback({ add: (skill) => void added.push(skill.id) })
        return { dispose: async () => void disposed++ }
      },
    } as never,
    [
      parseSkill("linear", "/x", skillText("linear")),
      parseSkill("linear-write", "/x", skillText("linear-write")),
    ],
  )
  assert.deepEqual(added, ["linear", "linear-write"])
  await registration.dispose()
  assert.equal(disposed, 1)
})
