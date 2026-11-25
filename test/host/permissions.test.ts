/**
 * The real 2.4.1 host refuses an unknown Linear tool at `read-only`: the generated `linear-work_*` write rule is what
 * `ctx.permission.assert` sees, so a tool Linear has not declared is denied rather than allowed by the base rule.
 *
 * The unit test (`test/permissions.test.ts`) covers all three levels through `rulesFor`/`evaluate`; this host test
 * proves the same rule reaches the host's own permission engine. `ask-changes` would prompt, and no person is present,
 * so it stays in the unit test.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { createHost } from "@we-the-rebel-alliance/plugin-contract/kit"

const ROOT = fileURLToPath(new URL("../../", import.meta.url))
const OPTIONS = { access: "read-only", accounts: { work: {} } }

test("the real 2.4.1 host denies an unknown Linear tool at read-only", { timeout: 120_000 }, async () => {
  const run = await createHost({ directory: ROOT, version: "2.4.1", pluginId: "linear", options: OPTIONS, timeoutMs: 60_000 })
  try {
    assert.equal(run.failure, undefined, run.failure)
    assert.ok(run.sessionID !== undefined, "the host made no activation session")
    const unknown = await run.assert({ sessionID: run.sessionID, action: "linear-work_save_task", resources: ["*"] })
    assert.equal(unknown.ok, false)
    if (!unknown.ok) assert.equal(unknown.code, "PERMISSION_DENIED")
    const renamed = await run.assert({ sessionID: run.sessionID, action: "linear-work_renamed_later", resources: ["*"] })
    assert.equal(renamed.ok, false)
    if (!renamed.ok) assert.equal(renamed.code, "PERMISSION_DENIED")
    const declaredWrite = await run.assert({ sessionID: run.sessionID, action: "linear-work_save_issue", resources: ["*"] })
    assert.equal(declaredWrite.ok, false)
    const read = await run.assert({ sessionID: run.sessionID, action: "linear-work_list_issues", resources: ["*"] })
    assert.equal(read.ok, true)
  } finally {
    await run.close()
  }
})
