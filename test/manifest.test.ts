import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { checkManifest, findSource, manifestHash } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { methodEntries } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor } from "../src/handlers/index.ts"
import { manifest, packageName, version } from "../src/manifest.ts"
import { runtimeFor } from "./support/handlers.ts"

interface RecordedTools {
  readonly count: number
  readonly tools: readonly { readonly name: string; readonly class: string }[]
}

const recorded = JSON.parse(readFileSync(new URL("./fixtures/mcp-tools.json", import.meta.url), "utf8")) as RecordedTools

const classes = (): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const method of Object.values(manifest.methods)) counts[method.class] = (counts[method.class] ?? 0) + 1
  return counts
}

test("the package and the manifest share one name, version and hash", () => {
  assert.equal(manifest.plugin.name, "linear")
  assert.equal(packageName, "@we-the-rebel-alliance/linear-plugin")
  assert.equal(version, "0.0.0")
  assert.equal(checkManifest(manifest).ok, true)
  assert.match(manifestHash(manifest), /^sha256:[0-9a-f]{64}$/)
  assert.deepEqual(manifest.plugin.host, { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  assert.ok(manifest.plugin.summary.length <= 400, `the namespace line is ${manifest.plugin.summary.length} characters`)
})

test("the methods table classifies all 83 callables and no method is pinned", () => {
  assert.equal(Object.keys(manifest.methods).length, 83)
  assert.deepEqual(classes(), { read: 46, write: 27, send: 4, delete: 4, share: 2 })
  for (const [name, item] of Object.entries(manifest.methods)) {
    assert.equal(item.pinned, undefined, `${name} is pinned`)
    if (name.startsWith("mcp:delete_")) assert.equal(item.class, "delete", name)
    if (name === "mcp:merge_diff") assert.equal(item.class, "write")
    if (name.startsWith("mcp:share_") || name === "mcp:unshare_issue") assert.equal(item.class, "share", name)
  }
  assert.equal(manifest.methods["status"]?.accounts, "none")
  for (const [name, item] of Object.entries(manifest.methods)) if (name !== "status") assert.equal(item.accounts, "optional", name)
})

test("every declared Linear tool is listed, and mcp:* keeps undeclared tools at write", () => {
  const wildcard = manifest.methods["mcp:*"]
  assert.deepEqual(wildcard, { class: "write", accounts: "optional" })
  assert.equal(recorded.count, 78)
  const ours = Object.entries(manifest.methods)
    .filter(([name]) => name.startsWith("mcp:") && name !== "mcp:*")
    .map(([name, item]) => ({ name: name.slice("mcp:".length), class: item.class }))
    .sort((left, right) => left.name.localeCompare(right.name))
  assert.deepEqual(ours, [...recorded.tools].sort((left, right) => left.name.localeCompare(right.name)))
})

test("the handler table declares exactly the manifest's own methods", () => {
  const entries = methodEntries(manifest, handlersFor(runtimeFor()))
  const own = entries.map((entry) => entry.name).sort()
  assert.deepEqual(own, ["events_list", "issues", "probe", "status"])
  assert.equal(entries.find((entry) => entry.name === "events_list")?.item.class, "read")
  assert.deepEqual(entries.find((entry) => entry.name === "probe")?.item.operations, ["get_workspace", "get_user"])
  // `issues` reads only `list_issues`; the identity reads belong to `probe` (and the activity page), so asserting them
  // on `issues` would demand permissions for a call it never makes.
  assert.deepEqual(entries.find((entry) => entry.name === "issues")?.item.operations, ["list_issues"])
})

test("the sources read declared methods, and their operations are among the method's", () => {
  const activity = findSource(manifest, "linear.activity")
  assert.equal(activity?.kind, "events")
  assert.equal(activity?.method, "events_list")
  const issues = findSource(manifest, "linear.issues")
  assert.equal(issues?.kind, "snapshot")
  assert.equal(issues?.method, "issues")
  for (const source of [activity, issues]) {
    assert.ok(source !== undefined)
    assert.ok(manifest.methods[source.method] !== undefined)
    const declared = new Set(manifest.methods[source.method]?.operations ?? [])
    for (const operation of source.operations ?? []) assert.ok(declared.has(operation), `${source.id} reads ${operation}, which ${source.method} does not declare`)
  }
})

test("two aliases resolve to the MCP servers OpenCode signs in to", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(plan.value.accounts.map((account) => account.alias), ["work", "personal"])
  assert.deepEqual(plan.value.accounts.map((account) => account.profile), [{}, {}])
  assert.equal(accountName(manifest.plugin.name, "work"), "linear-work")
  assert.equal(accountName(manifest.plugin.name, "personal"), "linear-personal")
  assert.equal(accountName(manifest.plugin.name, "default"), "linear")
})

test("the manifest declares every bus event and no action", () => {
  assert.deepEqual(Object.keys(manifest.events).sort(), ["account", "status"])
  assert.deepEqual(manifest.actions, [])
})

test("an unknown profile field is refused by the empty profile schema", () => {
  const plan = accountsOf(manifest, { accounts: { work: { workspace: "acme" } } })
  assert.equal(plan.ok, false)
  if (plan.ok) return
  assert.ok(plan.problems[0]?.includes("options.accounts.work"))
})
