/**
 * The plugin's skills: every `skills/<id>/SKILL.md` in the package, read at setup and registered with the host.
 *
 * The contract's `register` wires tools, Code Mode, RPC and the access rules, but it does not load skills. OpenCode
 * only discovers skills inside a project directory, so a plugin's own `skills/` folder is never read unless the plugin
 * registers it. This file does that: `ctx.skill.transform` adds one `Skill.Info` per folder, and the registration is
 * disposed with the rest of setup.
 *
 * The files are read before the synchronous transform runs. A broken or missing skill does not fail setup: the
 * server, the rules and the reads still work, and the problem is reported in `status` instead.
 */
import { access, readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

/** `skills/` at the package root, next to `dist/` in an install and next to `src/` in the repository. */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

const REINSTALL = "Reinstall the plugin from its release tag, or reinstall the version tag you installed."

const notLoaded = (name: string, problem: string) => `The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}.`

/** An error in the one shape the plugin reports: `CODE: What happened. Next step: What to do.` */
function skillError(problem: string): Error & { readonly code: "SKILLS_INVALID" } {
  return Object.assign(new Error(`SKILLS_INVALID: ${problem} Next step: ${REINSTALL}`), { code: "SKILLS_INVALID" as const })
}

/**
 * A YAML block scalar, clip-chomped as YAML does by default: the lines are dedented by the first non-empty line's
 * indentation, `>` folds single breaks into spaces and keeps a blank line as a newline, `|` keeps every newline, and
 * the result ends with one newline. It matches `YAML.parse` for the headers this frontmatter uses.
 */
function blockScalar(style: ">" | "|", raw: readonly string[]): string {
  const trimmed = raw.map((line) => line.trimEnd())
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] ?? "") === "") trimmed.pop()
  if (trimmed.length === 0) return ""
  const first = trimmed.find((line) => line.trim() !== "") ?? ""
  const indent = /^[ \t]*/.exec(first)?.[0].length ?? 0
  const lines = trimmed.map((line) => (line.trim() === "" ? "" : line.slice(indent)))
  if (style === "|") return `${lines.join("\n")}\n`
  let text = ""
  for (const line of lines) {
    if (line === "") text += "\n"
    else text += (text === "" || text.endsWith("\n") ? line : ` ${line}`)
  }
  return `${text}\n`
}

/**
 * Parses the frontmatter into its top-level fields: `key: value` lines, and the folded `>` or literal `|` block a
 * multi-line description uses. The body after the closing `---` is the skill's content.
 */
export function frontmatter(source: string): Map<string, string> {
  const fields = new Map<string, string>()
  const lines = source.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[index] ?? "")
    if (match === null) continue
    const key = match[1] ?? ""
    const raw = (match[2] ?? "").trim()
    if (raw === ">" || raw === "|") {
      const block: string[] = []
      while (index + 1 < lines.length && ((lines[index + 1] ?? "").trim() === "" || /^[ \t]/.test(lines[index + 1] ?? ""))) block.push(lines[++index] ?? "")
      fields.set(key, blockScalar(raw, block))
      continue
    }
    fields.set(key, raw.replace(/^(["'])(.*)\1$/, "$2"))
  }
  return fields
}

/** Parses one skill: the frontmatter names its folder and carries a description, and the body is not empty. */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const fail = (problem: string) => skillError(notLoaded(name, problem))
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (match === null) throw fail("has no frontmatter")
  const fields = frontmatter(match[1] ?? "")
  if (fields.get("name") !== name) throw fail(`must be named "${name}" in its frontmatter`)
  const description = fields.get("description")
  if (!description) throw fail("has no description")
  const content = (match[2] ?? "").trim()
  if (content === "") throw fail("has no content")
  return { id: Skill.ID.make(name), name: Skill.Name.make(name), description, path: Skill.Info.fields.path.make(path), content }
}

/**
 * Every skill folder in `directory`, sorted by name: a directory counts when it holds a `SKILL.md`. The package ships
 * `linear` and `linear-write`; adding a folder with a `SKILL.md` is all a new skill needs.
 */
export async function skillNames(directory = SKILLS_DIR): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const names: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      await access(join(directory, entry.name, "SKILL.md"))
      names.push(entry.name)
    } catch {
      // A folder without a SKILL.md is not a skill.
    }
  }
  return names.sort()
}

/**
 * Reads every `skills/<id>/SKILL.md` before the synchronous transform needs them. A broken skill becomes a problem that
 * `status` reports; it never stops setup.
 */
export async function loadSkills(directory = SKILLS_DIR) {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  let names: readonly string[]
  try {
    names = await skillNames(directory)
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "the skills/ folder is missing" : `the skills/ folder cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})`
    return { skills, problems: [skillError(`The plugin's skills were not loaded: ${reason}.`).message] }
  }
  for (const name of names) {
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
    } catch (error) {
      if ((error as { code?: unknown }).code === "SKILLS_INVALID") {
        problems.push((error as Error).message)
      } else {
        const code = (error as NodeJS.ErrnoException).code
        problems.push(skillError(notLoaded(name, code === "ENOENT" ? "is missing" : `cannot be read (${String(code)})`)).message)
      }
    }
  }
  return { skills, problems }
}

/** Adds every loaded skill to the host. Disposing the returned registration removes them again. */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) editor.add(info)
  })
}
