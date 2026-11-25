import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountsOf, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { announceStatus } from "../src/handlers/status.ts"
import { manifest, packageName } from "../src/manifest.ts"
import { callFor, recordingBus, run, runtimeFor } from "./support/handlers.ts"

interface RecordedCase {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
  readonly expect?: unknown
  readonly answer?: unknown
  readonly refuses?: string
}

interface Fixture {
  readonly plugin: string
  readonly namespace: string
  readonly accounts: {
    readonly real: boolean
    readonly aliases: readonly string[]
    readonly required: { readonly method: string; readonly code: string }
    readonly unknown: { readonly method: string; readonly account: string; readonly code: string }
    readonly cursors: readonly { readonly method: string; readonly account: string; readonly other: string; readonly code: string }[]
  }
  readonly sources: Record<string, { readonly cases?: readonly RecordedCase[]; readonly probe?: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown }; readonly snapshot?: { readonly input: Readonly<Record<string, unknown>>; readonly answer: unknown } }>
  readonly events: { readonly emitted: readonly string[]; readonly status: unknown }
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8")) as Fixture
const runtime = runtimeFor()
const activity = findSource(manifest, "linear.activity")
const issues = findSource(manifest, "linear.issues")
assert.ok(activity !== undefined)
assert.ok(issues !== undefined)
const recorded = fixture.sources["linear.activity"]
const recordedIssues = fixture.sources["linear.issues"]
assert.ok(recorded !== undefined)
assert.ok(recordedIssues !== undefined)
const cases = recorded.cases ?? []
assert.ok(cases.length > 0)

/** The input a handler sees: register removes the account selector. */
function withoutAccount(input: Readonly<Record<string, unknown>>): { readonly account: string; readonly input: Record<string, unknown> } {
  const { account, ...rest } = input
  return { account: typeof account === "string" ? account : "work", input: rest }
}

test("the fixture was recorded for this package and names the real two-account run", () => {
  assert.equal(fixture.plugin, packageName)
  assert.equal(fixture.namespace, manifest.plugin.summary)
  assert.equal(fixture.accounts.real, true)
  assert.deepEqual(fixture.accounts.aliases, ["work", "personal"])
})

test("the fixture's account cases are the contract's refusals", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  const required = resolveAccount(plan.value.accounts, {})
  assert.equal(required.ok === false ? required.code : undefined, fixture.accounts.required.code)
  const unknown = resolveAccount(plan.value.accounts, { account: fixture.accounts.unknown.account })
  assert.equal(unknown.ok === false ? unknown.code : undefined, fixture.accounts.unknown.code)
  assert.equal(fixture.accounts.required.method, "events_list")
  assert.equal(fixture.accounts.unknown.method, "events_list")
  assert.deepEqual(fixture.accounts.cursors.map((cursor) => [cursor.method, cursor.account, cursor.other, cursor.code]), [["events_list", "work", "personal", "CURSOR_INVALID"]])
})

test("every recorded page is what the handlers answer today, and the consumer's check accepts it", async () => {
  for (const item of cases) {
    const { account, input } = withoutAccount(item.input)
    if (item.refuses !== undefined) {
      await assert.rejects(
        () => run(runtime, "events_list", input, account),
        (error: unknown) => error instanceof SourceError && error.message === item.refuses,
        item.name,
      )
      continue
    }
    const answer = await run(runtime, "events_list", input, account)
    assert.deepEqual(answer, item.answer, item.name)
    const accepted = acceptAnswer(activity, account, answer)
    if (!accepted.ok) throw new Error(`${item.name}: ${accepted.failure.message}`)
  }
})

test("the recorded probe and snapshot answers are what the handlers answer today", async () => {
  assert.ok(recorded.probe !== undefined)
  const probe = withoutAccount(recorded.probe.input)
  assert.deepEqual(await run(runtime, "probe", probe.input, probe.account), recorded.probe.answer)

  assert.ok(recordedIssues.snapshot !== undefined)
  const snapshot = withoutAccount(recordedIssues.snapshot.input)
  const answer = await run(runtime, "issues", snapshot.input, snapshot.account)
  assert.deepEqual(answer, recordedIssues.snapshot.answer)
  const accepted = acceptAnswer(issues, snapshot.account, answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
})

test("the recorded status is what the status handler answers today", async () => {
  assert.deepEqual(await run(runtime, "status", {}), fixture.events.status)
})

test("the fixture records exactly the bus events the plugin's call sites emit", async () => {
  const changedBus = recordingBus()
  await run(runtime, "events_list", { source: "linear", since: "2026-11-01T00:00:00.000Z" }, "work", callFor("work", { bus: changedBus }))
  const signingIn = runtimeFor(undefined, {
    servers: async () => [
      { name: "linear-work", status: { status: "connected" } },
      { name: "linear-personal", status: { status: "needs_auth" } },
    ],
  })
  const accountBus = recordingBus()
  await run(signingIn, "status", {}, "work", callFor("work", { bus: accountBus }))
  const statusBus = recordingBus()
  await announceStatus(statusBus, [])
  const emitted = [...new Set([...changedBus.emitted, ...accountBus.emitted, ...statusBus.emitted].map((entry) => entry.event))]
  assert.deepEqual([...fixture.events.emitted].sort(), emitted.sort())
  assert.deepEqual(emitted.sort(), ["account", "changed", "status"])
})
