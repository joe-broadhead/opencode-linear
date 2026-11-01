// Pack, install and load the published shape. The tarball holds exactly the files whitelist and installs with
// lifecycle scripts disabled. Installed alone, it loads in each stock OpenCode release it is tested on, which provides
// @opencode/plugin, OpenTUI and Solid itself; next to those packages, both entry points also import under Bun.
// OPENCODE_BIN_2_2_3 and OPENCODE_BIN_2_2_4 name stock binaries; otherwise each release is installed with npm.
// PACK_TARBALL names a tarball that was already packed, such as the one the release publishes, to test it instead.
import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform, tmpdir } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { ENDPOINTS } from "../../src/constants.js"
import { defaultRules, type Rule } from "../../src/permissions.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  files: string[]
  exports: Record<string, string>
  devDependencies: Record<string, string>
}
// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(tmpdir(), "linear-pack-")))
// Removing the installed packages and binaries can take longer than the default hook timeout.
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

/** The host's ID for a remote MCP server's integration, derived from its name and URL. */
const integrationID = (name: string, url: string) => `mcp_${createHash("sha1").update(`${name}\0${url}`).digest("hex").slice(0, 16)}`

const MAX_FILES = 30
const MAX_PACKED_BYTES = 100 * 1024
// The two self-contained entry bundles, and nothing else, in dist/.
const DIST = ["dist/index.js", "dist/tui.js"]
// Modules the host serves to plugins at runtime. Everything else must be inlined in the bundle.
const SERVER_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/, /^@opentui\//, /^solid-js(?:\/|$)/]
// The host packages OpenCode 2.2.3 ships; the versions come from devDependencies.
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
// The stock OpenCode releases the package is tested on.
const HOST_VERSIONS = ["2.2.3", "2.2.4"]
// Anything a stock host tries on the network goes to a closed port, except loopback.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

type Packed = { filename: string; size: number; entryCount: number; files: { path: string }[] }

let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  if (given) {
    const tarball = resolve(given)
    copyFileSync(tarball, join(work, basename(tarball)))
    const files = run("tar", ["-tzf", tarball], root).trim().split("\n").filter((path) => !path.endsWith("/")).map((path) => ({ path: path.replace(/^package\//, "") }))
    packed = { filename: basename(tarball), size: statSync(tarball).size, entryCount: files.length, files }
    return packed
  }
  // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
  run("node", [join(root, "scripts", "check.mjs"), "build"], root)
  const result = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)
  packed = (JSON.parse(result) as Packed[])[0]!
  return packed
}

/** An empty project with its own package.json, so npm never walks up to another one. */
function project(name: string): string {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `linear-pack-${name}`, private: true, type: "module" }))
  return dir
}

const installs = new Map<string, string>()
/** The tarball installed with scripts disabled, alone or next to the host packages. */
function install(withHostPackages: boolean): string {
  const name = withHostPackages ? "with-host-packages" : "alone"
  const existing = installs.get(name)
  if (existing) return existing
  const dir = project(name)
  const hosts = withHostPackages ? HOST_PACKAGES.map((item) => `${item}@${pkg.devDependencies[item]}`) : []
  run("npm", ["install", join(work, pack().filename), ...hosts, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  installs.set(name, dir)
  return dir
}

const installedPackage = (withHostPackages: boolean) => join(install(withHostPackages), "node_modules", ...pkg.name.split("/"))

/** A home, OpenCode's test home, XDG folders and a temp folder, all inside `base`. */
function isolated(base: string) {
  const home = join(base, "home")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(base, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  return env
}

describe("package tarball", () => {
  test("lists exactly the files whitelist, under the size and file limits", () => {
    const { files, entryCount, size } = pack()
    const paths = files.map((file) => file.path).sort()
    const expected = ["package.json", ...pkg.files.flatMap((entry) => whitelisted(entry))].sort()
    expect(paths).toEqual(expected)
    expect(entryCount).toBeLessThan(MAX_FILES)
    expect(size).toBeLessThanOrEqual(MAX_PACKED_BYTES)
    expect(paths.filter((path) => path.includes("node_modules/") || /\.(?:tsx|jsx)$/.test(path))).toEqual([])
    for (const target of Object.values(pkg.exports)) expect(paths).toContain(target.replace(/^\.\//, ""))
    expect(paths.filter((path) => path.endsWith(".d.ts"))).toEqual([])
  }, 120_000)

  test("installs with scripts disabled and loads both entry points under Bun, next to the host packages", () => {
    const consumer = install(true)
    const probe = join(consumer, "probe.mjs")
    writeFileSync(probe, [
      "const out = {}",
      `for (const [part, specifier] of [["server", ${JSON.stringify(pkg.name)}], ["tui", ${JSON.stringify(`${pkg.name}/tui`)}]]) {`,
      "  const plugin = (await import(specifier)).default",
      "  out[part] = { id: plugin?.id, setup: typeof plugin?.setup }",
      "}",
      "console.log(JSON.stringify(out))",
    ].join("\n"))
    const output = run(process.execPath, [probe], consumer, { PATH: process.env.PATH, ...isolated(join(work, "bun-probe")) })
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      server: { id: "linear.workspace", setup: "function" },
      tui: { id: "linear.workspace.tui", setup: "function" },
    })
  }, 300_000)

  // OpenCode reloads a plugin in place and reuses the module records it holds for unchanged paths, so an entry that
  // imported a sibling module could get an older cached copy of it. Each entry must stand alone.
  test("dist holds only the two entry bundles, and they import no sibling module", () => {
    const dist = join(installedPackage(true), "dist")
    expect(tree(relative(root, dist), dist).sort()).toEqual(["index.js", "tui.js"])
    for (const file of ["index.js", "tui.js"]) expect(relativeImports(readFileSync(join(dist, file), "utf8"))).toEqual([])
  }, 300_000)

  test("dist imports only modules the host provides", () => {
    const dist = join(installedPackage(true), "dist")
    expect(foreign(join(dist, "index.js"), SERVER_HOST_MODULES)).toEqual([])
    expect(foreign(join(dist, "tui.js"), TUI_HOST_MODULES)).toEqual([])
  }, 300_000)
})

describe.each(HOST_VERSIONS)("installed alone, in stock OpenCode %s", (version) => {
  test("is active, registers linear for the chosen access, adds the default rules, and answers the status RPC", async () => {
    const installed = installedPackage(false)
    const host = await serve(version, installed)
    try {
      const plugin = await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === "linear.workspace")
        return found && found.state.status !== "loading" ? found : undefined
      })
      expect(plugin.state).toEqual({ status: "active" })

      // Read access registers Linear's read-only server, write access the full one, each under the name linear.
      for (const [access, directory] of [["read", host.directory], ["write", host.writeDirectory]] as const) {
        const server = await host.until(`the linear server is registered for ${access} access`, async () => {
          const { data } = await host.api<{ data: { name: string; integrationID?: string }[] }>("GET", "/api/mcp", undefined, directory)
          return data.find((item) => item.name === "linear")
        })
        expect(server.integrationID).toBe(integrationID("linear", ENDPOINTS[access]))
        // /connect lists integrations from this endpoint, MCP servers first; Linear's sign-in shows under its brand.
        const listed = await host.until(`/connect lists the ${access} server as Linear`, async () => {
          const { data } = await host.api<{ data: { id: string; name: string; metadata?: { source?: string } }[] }>("GET", "/api/integration", undefined, directory)
          const found = data.find((item) => item.id === server.integrationID)
          return found?.name === "Linear" ? found : undefined
        })
        expect(listed.metadata?.source).toBe("mcp")
      }
      const build = await host.until("the build agent has the default rules", async () => {
        const { data } = await host.api<{ data: { id: string; permissions: Rule[] }[] }>("GET", "/api/agent")
        const permissions = data.find((agent) => agent.id === "build")?.permissions
        return permissions?.some((rule) => rule.action === "linear_*") ? permissions : undefined
      })
      const rules = defaultRules()
      expect(build[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
      expect(build.slice(1, 1 + rules.length)).toEqual(rules)

      const { output } = await host.api<{ output: Record<string, unknown> }>("POST", "/api/rpc/linear.workspace/status", { input: {} })
      expect(output).toMatchObject({
        access: "read",
        source: { type: "plugin", url: ENDPOINTS.read },
        agentsWithoutRules: ["reviewer"],
        host: { version, tested: true },
        problems: [],
      })
      const { data: skills } = await host.api<{ data: { id: string; path: string }[] }>("GET", "/api/skill")
      expect(skills.filter((skill) => skill.id.startsWith("linear"))).toMatchObject([{ id: "linear", path: join(installed, "skills", "linear", "SKILL.md") }])
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
    }
  }, 600_000)
})

/** OPENCODE_BIN_<version>, or the unmodified npm release with its platform binary, installed with scripts disabled. */
function stockBinary(version: string): string {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  const binary = `@opencode/cli-${platform()}-${arch()}`
  const dir = project(`opencode-${version}`)
  // Only this platform's binary: each one is a few hundred megabytes.
  run("npm", ["install", `@opencode/cli@${version}`, `${binary}@${version}`, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  return join(dir, "node_modules", binary, "bin", "opencode")
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/**
 * `opencode serve` on its own port and password, in an environment that holds only its temp root and is offline, with
 * a project that loads the installed package and defines one agent only in user config, and a second project that
 * loads it with `access: "write"`.
 */
async function serve(version: string, installed: string) {
  const binary = stockBinary(version)
  const base = join(work, `stock-${version}`)
  const directory = join(base, "project")
  const writeDirectory = join(base, "project-write")
  // Keep the built-in local providers from probing their default ports.
  const providers = { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } }
  for (const [dir, config] of [
    [directory, { plugins: [installed], agents: { reviewer: { description: "Reviews changes", mode: "subagent" } }, providers }],
    [writeDirectory, { plugins: [{ package: installed, options: { access: "write" } }], providers }],
  ] as const) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), JSON.stringify(config))
  }
  const password = randomUUID()
  const env = { ...isolated(base), ...OFFLINE, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }

  expect(run(binary, ["--version"], directory, env).trim()).toBe(`opencode v${version}`)
  // OpenCode resolves every global path from this environment; none may leave the temp root.
  const paths = run(binary, ["debug", "paths"], directory, env).trim().split("\n").map((line) => line.trim().split(/\s+/))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(([, path]) => !path?.startsWith(base + sep))).toEqual([])

  const port = await freePort()
  let log = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (log += chunk))
  server.stderr.on("data", (chunk) => void (log += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const api = async <T>(method: string, path: string, body?: unknown, location = directory): Promise<T> => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", location)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
    return JSON.parse(text) as T
  }
  /** Polls until `read` returns a value. The server answers before plugins finish loading, more slowly when busy. */
  const until = async <T>(what: string, read: () => Promise<T | false | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await Bun.sleep(500)) {
      const value = await read().catch((error: unknown) => (Date.now() > deadline ? Promise.reject(error) : undefined))
      if (value) return value
      if (server.exitCode !== null) throw new Error(`opencode ${version} exited before ${what}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    }
  }
  const close = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
    await exited
    clearTimeout(timer)
  }
  return { api, until, close, directory, writeDirectory, log: () => log }
}

// The files a `files` entry should put in the tarball. dist/ must hold exactly the two bundles, so stale or foreign
// build output fails the comparison, and so does a missing whitelisted file.
function whitelisted(entry: string): string[] {
  if (entry === "dist") return DIST
  const path = join(root, entry)
  if (!existsSync(path)) return [`${entry} (missing)`]
  return statSync(path).isDirectory() ? tree(entry) : [entry]
}

/** Every file under `dir`, as paths relative to `base` (the repository root by default). */
function tree(dir: string, base = root): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(base, join(item.parentPath, item.name)).split(sep).join("/"))
}

/** Every module specifier in a file: static imports and re-exports, dynamic `import()` and `require()`. */
const specifiers = (source: string) =>
  [...source.matchAll(/(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["'`]?([^"'`)]*)["'`]?\s*\)/g)].map((match) => (match[1] ?? match[2])!)

/** Relative imports, and every dynamic `import()` or `require()` call: a self-contained bundle has none. */
const relativeImports = (source: string) => [
  ...specifiers(source).filter((specifier) => specifier.startsWith(".")),
  ...[...source.matchAll(/(?<![\w$.])(?:import|require)\s*\(/g)].map((match) => match[0]),
]

/** The bare specifiers of one bundle that the allowed list does not cover. */
const foreign = (file: string, allowed: RegExp[]) =>
  [...new Set(specifiers(readFileSync(file, "utf8")).filter((specifier) => !allowed.some((pattern) => pattern.test(specifier))))].sort()

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false" }): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
