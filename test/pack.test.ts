import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

test("the packed tarball holds the built server, skills, assets and licence, and no source", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr)
  const packed = JSON.parse(result.stdout) as { readonly files: readonly { readonly path: string }[]; readonly entryCount: number }[]
  const files = (packed[0]?.files ?? []).map((file) => file.path)
  for (const required of ["package.json", "dist/index.js", "skills/linear/SKILL.md", "skills/linear-write/SKILL.md", "assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png", "README.md", "LICENSE"]) {
    assert.ok(files.includes(required), `${required} is not packed`)
  }
  assert.ok(files.every((file) => !file.startsWith("src/") && !file.startsWith("test/") && !file.startsWith("fixtures/")), files.join("\n"))
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { exports: Record<string, string>; files: readonly string[] }
  assert.equal(pkg.exports["./server"], "./dist/index.js")
  assert.deepEqual(pkg.files, ["dist", "skills", "assets", "README.md", "LICENSE"])
})
