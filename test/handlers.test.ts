import assert from "node:assert/strict"
import { test } from "node:test"
import { STATUS_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { announceStatus } from "../src/handlers/status.ts"
import { manifest } from "../src/manifest.ts"
import { NOW, callFor, recordingBus, run, runtimeFor } from "./support/handlers.ts"

const runtime = runtimeFor()

function codeOf(action: () => Promise<unknown>): Promise<string | undefined> {
  return action().then(
    () => undefined,
    (error: unknown) => (error instanceof SourceError ? error.code : undefined),
  )
}

test("status names the plugin, its host, both accounts and the access rules' agents", async () => {
  const answer = (await run(runtime, "status", {})) as Record<string, unknown>
  assert.equal(answer["name"], "linear")
  assert.equal(answer["version"], "0.0.10")
  assert.equal(answer["state"], "ready")
  assert.equal(answer["nextStep"], null)
  assert.deepEqual(answer["host"], { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  assert.deepEqual((answer["accounts"] as Record<string, unknown>[]).map((account) => [account["alias"], account["state"]]), [["work", "ready"], ["personal", "ready"]])
  assert.deepEqual(answer["unguardedAgents"], [])
  assert.deepEqual(Object.keys(answer).sort(), Object.keys(STATUS_SCHEMA.properties ?? {}).sort())
})

test("status maps a server that needs a sign-in, nudges the account, and names the next step", async () => {
  const servers = runtimeFor(undefined, {
    servers: async () => [
      { name: "linear-work", status: { status: "connected" } },
      { name: "linear-personal", status: { status: "needs_auth", error: "the refresh token expired" } },
    ],
  })
  const bus = recordingBus()
  const answer = (await run(servers, "status", {}, "work", callFor("work", { bus }))) as Record<string, unknown>
  assert.equal(answer["state"], "needs_sign_in")
  assert.deepEqual((answer["accounts"] as Record<string, unknown>[]).map((account) => [account["alias"], account["state"]]), [["work", "ready"], ["personal", "needs_sign_in"]])
  assert.equal(answer["nextStep"], "Sign in to the account that needs it, then read status again.")
  assert.deepEqual(bus.emitted, [{ event: "account", data: { account: "personal", state: "needs_sign_in" } }])
})

test("status reports a failed server on its account and redacts the reason", async () => {
  const servers = runtimeFor(undefined, {
    servers: async () => [
      { name: "linear-work", status: { status: "failed", error: "callback failed at https://mcp.linear.app/callback?token=secret-value" } },
      { name: "linear-personal", status: { status: "connected" } },
    ],
  })
  const answer = (await run(servers, "status", {})) as Record<string, unknown>
  const accounts = answer["accounts"] as Record<string, unknown>[]
  assert.deepEqual(accounts.map((account) => [account["alias"], account["state"]]), [["work", "error"], ["personal", "ready"]])
  assert.equal(accounts[0]?.["reason"], "callback failed at https://mcp.linear.app/callback?token=…")
  assert.equal(answer["state"], "error")
  assert.equal(answer["nextStep"], "work: callback failed at https://mcp.linear.app/callback?token=…")
})

test("status names an agent that no longer holds the generated rules", async () => {
  const answer = (await run(runtime, "status", {}, "work", callFor("work", { unguarded: ["build"] }))) as Record<string, unknown>
  assert.deepEqual(answer["unguardedAgents"], ["build"])
})

test("status reports an unreadable agent list as a problem, not a zero", async () => {
  const call = { ...callFor("work"), unguardedAgents: async () => ({ ok: false, error: "the agent list could not be read" }) } as unknown as Parameters<typeof run>[4]
  const answer = (await run(runtime, "status", {}, "work", call)) as Record<string, unknown>
  assert.equal(answer["state"], "error")
  assert.equal(answer["nextStep"], "the agent list could not be read")
  assert.deepEqual(answer["unguardedAgents"], [])
})

test("status reports a setup problem as an error with a redacted next step", async () => {
  const broken = runtimeFor(undefined, { problems: () => ["linear-work: the server failed at https://mcp.linear.app/x?key=abc"] })
  const answer = (await run(broken, "status", {})) as Record<string, unknown>
  assert.equal(answer["state"], "error")
  assert.equal(answer["nextStep"], "linear-work: the server failed at https://mcp.linear.app/x?key=…")
})

test("announceStatus emits the plugin's state once", async () => {
  const bus = recordingBus()
  await announceStatus(bus, [])
  await announceStatus(bus, ["a problem"])
  assert.deepEqual(bus.emitted, [
    { event: "status", data: { state: "ready" } },
    { event: "status", data: { state: "error" } },
  ])
})

test("probe answers the account's owner and no content", async () => {
  assert.deepEqual(await run(runtime, "probe", {}, "personal"), {
    source: "linear",
    account: "personal",
    owner: { id: "mailto:ada@personal.example", label: "Ada Lane (studio)" },
    trust: "untrusted",
  })
})

test("probe refuses an unknown source and extra input", async () => {
  assert.equal(await codeOf(() => run(runtime, "probe", { source: "other" })), "SOURCE_UNKNOWN")
  assert.equal(await codeOf(() => run(runtime, "probe", { limit: 1 })), "INPUT_INVALID")
})

test("events_list answers a page the consumer's own check accepts, and emits nothing", async () => {
  const bus = recordingBus()
  const answer = await run(runtime, "events_list", { source: "linear", since: "2026-11-01T00:00:00.000Z" }, "work", callFor("work", { bus }))
  const source = findSource(manifest, "linear.activity")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "events")
  assert.equal(accepted.page.events.length, 5)
  // The plugin owns no write, so a read is not a change: no bus event.
  assert.deepEqual(bus.emitted, [])
})

test("events_list emits nothing when the page lists nothing", async () => {
  const bus = recordingBus()
  await run(runtime, "events_list", { source: "linear", since: "2026-11-25T00:00:00.000Z" }, "work", callFor("work", { bus }))
  assert.deepEqual(bus.emitted, [])
})

test("events_list refuses an unknown source, an invalid limit, a scope it does not read and another account's cursor", async () => {
  const source = findSource(manifest, "linear.activity")
  assert.ok(source !== undefined)
  assert.equal(await codeOf(() => run(runtime, "events_list", { source: "other" })), "SOURCE_UNKNOWN")
  assert.equal(await codeOf(() => run(runtime, "events_list", { limit: 0 })), "INPUT_INVALID")
  assert.equal(await codeOf(() => run(runtime, "events_list", { scope: { teams: ["ENG"] } })), "INPUT_INVALID")
  const first = (await run(runtime, "events_list", { since: "2026-11-01T00:00:00.000Z" })) as { cursor: string }
  assert.equal(await codeOf(() => run(runtime, "events_list", { cursor: first.cursor }, "personal")), "CURSOR_INVALID")
})

test("issues answers the snapshot the consumer's check accepts", async () => {
  const answer = await run(runtime, "issues", { source: "linear" })
  const source = findSource(manifest, "linear.issues")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", answer)
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "snapshot")
  const data = answer as { data: { items: unknown[]; editable: boolean }; asOf: string }
  assert.equal(data.data.items.length, 4)
  assert.equal(data.data.editable, false)
  assert.equal(data.asOf, new Date(NOW).toISOString())
})

test("issues refuses an unknown source", async () => {
  assert.equal(await codeOf(() => run(runtime, "issues", { source: "other" })), "SOURCE_UNKNOWN")
})
