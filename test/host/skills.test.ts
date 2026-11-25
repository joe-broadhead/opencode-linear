/**
 * The real OpenCode 2.4.1 host lists every skill the plugin ships, by the id its folder gives it.
 *
 * The contract's `createHost` records tools, RPC, agents and asks, but not skills, so this test builds the same
 * embedded host the kit builds (`@we-the-rebel-alliance/plugin-contract` `dist/internal/host/createHost`: one
 * `OpenCode.create`, a session, one queued prompt, then `waitForActivation`) and reads the host client's own
 * `skill.list` (`@opencode/client/dist/promise/client.d.ts:182-184`). The plugin loaded is the committed
 * `dist/index.js`, the file an install runs, so a `skills/` folder that is not registered fails this test.
 *
 * Before `@opencode/sdk` loads, the environment is moved into a fresh temp root: HOME, the XDG folders, the config
 * directory, the project directory and the database all live there, so the host never reads this machine's skills or
 * configuration. `client.skill.list` also lists OpenCode's own skills; the assertions are about the plugin's ids.
 */
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { parse as parseYaml } from "yaml"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const SKILLS = join(ROOT, "skills")
/** The two skills the plugin ships; a release that drops one is a parity regression, not a test update. */
const SHIPPED = ["linear", "linear-write"]

/** The frontmatter of one SKILL.md, as the YAML parser reads it: the source of truth for the description text. */
function frontmatterOf(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  assert.ok(match, `${path} has no frontmatter`)
  const parsed = parseYaml(match[1] ?? "") as unknown
  assert.ok(typeof parsed === "object" && parsed !== null, `${path}'s frontmatter is not a mapping`)
  return parsed as Record<string, unknown>
}

const root = mkdtempSync(join(tmpdir(), "linear-skills-host-"))
const home = join(root, "home")
const config = join(root, "config")
const work = join(root, "work")
for (const directory of [home, config, work]) mkdirSync(directory, { recursive: true })
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  TMPDIR: join(root, "tmp"),
})
mkdirSync(join(root, "tmp"), { recursive: true })

test("the built plugin registers every skills/*/SKILL.md on the real 2.4.1 host", { timeout: 120_000 }, async (t) => {
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const expected = readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
  for (const id of SHIPPED) assert.ok(expected.includes(id), `skills/${id}/SKILL.md is missing`)

  const module = (await import(pathToFileURL(join(ROOT, "dist", "index.js")).href)) as { default?: { id?: string; setup?: unknown } }
  const plugin = module.default
  assert.equal(plugin?.id, "linear")
  assert.equal(typeof plugin?.setup, "function")

  const { OpenCode } = await import("@opencode/sdk")
  const host = await OpenCode.create({
    plugins: [plugin as never],
    app: { name: "opencode", version: "2.4.1" },
    config: { content: "{}", directory: config, project: false },
    database: { path: join(root, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error", emit: () => undefined },
  })
  const location = { directory: work }
  /** The parts of the host's plugin and skill entries this test reads. */
  interface HostEntry {
    readonly id: string
    readonly state?: { readonly status?: string; readonly error?: string }
  }
  interface HostSkill {
    readonly id: string
    readonly name: string
    readonly description?: string
    readonly path: string
    readonly content: string
  }
  try {
    const session = await host.sessions.create({ location, agent: "build", permissions: [] } as never)
    await host.sessions.prompt({ sessionID: session.id, text: "activate the plugin", delivery: "queue" } as never).catch(() => undefined)

    const deadline = Date.now() + 60_000
    for (;;) {
      const entries = (await host.plugin.list({ location })) as unknown as { readonly data: readonly HostEntry[] }
      const entry = entries.data.find((item) => item.id === "linear")
      const state = entry?.state
      if (state?.status === "active") break
      assert.notEqual(state?.status, "failed", `the plugin failed to start: ${JSON.stringify(state)}`)
      assert.ok(Date.now() < deadline, "the plugin did not activate within 60 s")
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const answer = (await host.skill.list({ location })) as unknown as { readonly data: readonly HostSkill[] }
    const listed = new Map(answer.data.map((skill) => [skill.id, skill]))
    for (const id of expected) {
      const skill = listed.get(id)
      assert.ok(skill, `skills/${id}/SKILL.md is not registered; the host lists ${[...listed.keys()].join(", ")}`)
      const parsed = frontmatterOf(join(SKILLS, id, "SKILL.md"))
      const description = parsed["description"]
      assert.equal(typeof description, "string", `${id}'s frontmatter has no description`)
      assert.ok((description as string).trim().length > 0, `${id} has an empty description`)
      assert.notEqual(description, ">", `${id}'s description is the folded marker`)
      assert.notEqual(description, "|", `${id}'s description is the literal marker`)
      assert.equal(String(skill.name), id)
      assert.equal(skill.description, description, `${id}'s registered description is not what YAML.parse reads`)
      assert.ok(skill.content.trim().length > 0, `${id} has no content`)
      assert.equal(skill.path, join(SKILLS, id, "SKILL.md"), `${id} points at the wrong file`)
    }
    // The plugin's own ids, named here as well as derived from the folder, so a missing one is never an empty pass.
    for (const id of SHIPPED) assert.ok(listed.has(id), `${id} is not registered on the real 2.4.1 host`)
  } finally {
    await host.close()
  }
})
