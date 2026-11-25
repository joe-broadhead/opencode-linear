/**
 * The generated access rules fail closed for a Linear tool the manifest has never seen.
 *
 * The 78 declared `mcp:<tool>` ids keep their own class, so a known write is denied at `read-only` and asked at
 * `ask-changes`. `mcp:*` is class `write` and is emitted before them, so a renamed or unknown tool falls through to
 * it: `linear-work_save_task` is denied at `read-only` and asked at `ask-changes`, never allowed by OpenCode's base
 * allow-all. A declared read still runs under every level.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { evaluate, rulesFor } from "@we-the-rebel-alliance/plugin-contract/access"
import { manifest } from "../src/manifest.ts"

const effect = (level: "read-only" | "ask-changes" | "all", action: string, aliases: readonly string[] = ["work"]) =>
  evaluate(rulesFor(manifest, level, aliases), action, "*")

test("an unknown Linear tool is denied at read-only, asked at ask-changes and allowed at all", () => {
  for (const action of ["linear-work_save_task", "linear-work_renamed_later"]) {
    assert.equal(effect("read-only", action), "deny", action)
    assert.equal(effect("ask-changes", action), "ask", action)
    assert.equal(effect("all", action), "allow", action)
  }
  assert.equal(effect("read-only", "linear_save_task", ["default"]), "deny")
  assert.equal(effect("ask-changes", "linear_save_task", ["default"]), "ask")
})

test("a declared read still runs at read-only, and a declared write keeps its class", () => {
  assert.equal(effect("read-only", "linear-work_list_issues"), "allow")
  assert.equal(effect("read-only", "linear-work_get_issue"), "allow")
  assert.equal(effect("read-only", "linear-work_save_issue"), "deny")
  assert.equal(effect("ask-changes", "linear-work_save_issue"), "ask")
  assert.equal(effect("read-only", "linear-work_delete_comment"), "deny")
  assert.equal(effect("ask-changes", "linear-work_share_issue"), "ask")
})

test("mcp:* is a write wildcard, emitted before the 78 specifics, which stay", () => {
  assert.deepEqual(manifest.methods["mcp:*"], { class: "write", accounts: "optional" })
  const rules = rulesFor(manifest, "read-only", ["work"])
  const wildcard = rules.findIndex((rule) => rule.action === "linear-work_*")
  const specific = rules.findIndex((rule) => rule.action === "linear-work_save_issue")
  assert.ok(wildcard !== -1, "the server-level wildcard is missing")
  assert.ok(specific > wildcard, "the wildcard must come before the specific rules, so the last match wins")
  assert.equal(Object.keys(manifest.methods).filter((name) => name.startsWith("mcp:") && name !== "mcp:*").length, 78)
})
