// Imported first, before anything loads OpenCode. OpenCode derives its global paths from the environment, and under
// Bun os.homedir() ignores a changed HOME, so the whole environment is replaced: HOME, OPENCODE_TEST_HOME, XDG_* and
// TMPDIR point into a fresh temp root, nothing else is inherited (no parent OpenCode, provider key or proxy), and the
// working directory moves there too, because the host also opens a location at it.
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

/** A folder whose node_modules holds another @opencode/sdk 2.2.x, such as 2.2.4, to host the suite instead. */
export const HOST_SDK_DIR = process.env.HOST_SDK_DIR ? resolve(process.env.HOST_SDK_DIR) : undefined
export const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "linear-host-")))
const home = join(ROOT, "home")
const KEEP = ["PATH", "LANG", "TZ", "TERM"]
for (const key of Object.keys(process.env)) if (!KEEP.includes(key) && !key.startsWith("BUN_")) delete process.env[key]
Object.assign(process.env, {
  HOME: home,
  OPENCODE_TEST_HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  TMPDIR: join(ROOT, "tmp"),
})
for (const dir of [home, join(ROOT, "tmp")]) mkdirSync(dir, { recursive: true })
process.chdir(home)
