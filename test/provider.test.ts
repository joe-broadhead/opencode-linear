import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError, type EventsListRequest } from "@we-the-rebel-alliance/plugin-contract/events"
import { findSource } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { acceptAnswer } from "@we-the-rebel-alliance/plugin-contract/read"
import { manifest } from "../src/manifest.ts"
import { createProvider, SOURCE } from "../src/provider/client.ts"
import { NOW, fakeRead, runtimeFor, toolCall } from "./support/handlers.ts"

const provider = runtimeFor().provider
const request = (overrides: Partial<EventsListRequest> = {}): EventsListRequest => ({ limit: 100, ...overrides })
const since = Date.parse("2026-11-01T00:00:00.000Z")

/** The `SourceError` code a call refuses with, or undefined when it answers. */
function refusalCode(action: () => Promise<unknown>): Promise<string | undefined> {
  return action().then(
    () => undefined,
    (error: unknown) => (error instanceof SourceError ? error.code : undefined),
  )
}

test("a work page lists issue changes and notifications oldest first, marked untrusted", async () => {
  const page = await provider.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  assert.equal(page.source, SOURCE)
  assert.equal(page.account, "work")
  assert.equal(page.owner.id, "mailto:ada@example.test")
  assert.equal(page.trust, "untrusted")
  assert.deepEqual(
    page.events.map((event) => event.external_id),
    ["ENG-103@2026-11-22T08:00:00.000Z", "ENG-102@2026-11-23T09:30:00.000Z", "notification:n-work-2", "ENG-101@2026-11-24T10:00:00.000Z", "notification:n-work-1"],
  )
  const times = page.events.map((event) => Date.parse(event.occurred_at))
  assert.deepEqual(times, [...times].sort((left, right) => left - right))
})

test("an issue holding a secret is refused for good and never listed", async () => {
  const page = await provider.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  assert.deepEqual(page.refused?.map((entry) => [entry.external_id, entry.reason]), [["ENG-104@2026-11-21T07:00:00.000Z", "secret"]])
  assert.ok(page.events.every((event) => event.external_id !== "ENG-104@2026-11-21T07:00:00.000Z"))
})

test("the personal account reads only its own issues and notifications", async () => {
  const page = await provider.page({ account: "personal", request: request({ since }), now: NOW, call: toolCall("personal") })
  assert.deepEqual(page.events.map((event) => event.external_id), ["STUDIO-1@2026-11-23T18:00:00.000Z", "notification:n-studio-1"])
  assert.ok(page.events.every((event) => event.account === "personal"))
  assert.equal(page.owner.id, "mailto:ada@personal.example")
})

test("a cursor lists what follows and then an empty page with a cursor", async () => {
  const first = await provider.page({ account: "work", request: request({ since, limit: 2 }), now: NOW, call: toolCall("work") })
  assert.deepEqual(first.events.map((event) => event.external_id), ["ENG-103@2026-11-22T08:00:00.000Z", "ENG-102@2026-11-23T09:30:00.000Z"])
  assert.equal(first.more, true)
  const second = await provider.page({ account: "work", request: request({ cursor: first.cursor }), now: NOW, call: toolCall("work") })
  assert.deepEqual(second.events.map((event) => event.external_id), ["notification:n-work-2", "ENG-101@2026-11-24T10:00:00.000Z", "notification:n-work-1"])
  assert.equal(second.more, false)
  const third = await provider.page({ account: "work", request: request({ cursor: second.cursor }), now: NOW, call: toolCall("work") })
  assert.deepEqual(third.events, [])
  assert.equal(third.more, false)
})

test("another account's cursor is refused, not restarted", async () => {
  const first = await provider.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  assert.equal(await refusalCode(() => provider.page({ account: "personal", request: request({ cursor: first.cursor }), now: NOW, call: toolCall("personal") })), "CURSOR_INVALID")
})

test("a malformed cursor is refused and an empty window still answers a cursor", async () => {
  assert.equal(await refusalCode(() => provider.page({ account: "work", request: request({ cursor: "not-a-cursor" }), now: NOW, call: toolCall("work") })), "CURSOR_INVALID")
  const empty = await provider.page({ account: "work", request: request({ since: Date.parse("2026-11-25T00:00:00.000Z") }), now: NOW, call: toolCall("work") })
  assert.deepEqual(empty.events, [])
  assert.ok(empty.cursor.length > 0)
})

test("the same call answers the same page, hashes included, and the consumer's check accepts it", async () => {
  const call = () => provider.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  assert.deepEqual(await call(), await call())
  const source = findSource(manifest, "linear.activity")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", await call())
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "events")
})

test("every event's url is on a declared host, and the page fits its source", async () => {
  const page = await provider.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  for (const event of page.events) {
    assert.ok(event.url === null || event.url.startsWith("https://linear.app/"), String(event.url))
    assert.equal(event.kind, "issue")
  }
})

test("one feed failing lists the other, names the failed feed and holds its cursor", async () => {
  let failing = true
  const providerWithFailure = createProvider({
    plugin: "linear",
    package: "@we-the-rebel-alliance/linear-plugin",
    read: async (account, tool, input, call) => {
      if (tool === "list_issues" && failing) throw new SourceError({ code: "UNAVAILABLE", what: "Linear's list_issues failed", next: "Try again." })
      return fakeRead(account, tool, input, call)
    },
  })
  const first = await providerWithFailure.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })
  assert.deepEqual(first.events.map((event) => event.external_id), ["notification:n-work-2", "notification:n-work-1"])
  assert.deepEqual(first.failed, [{ external_id: "feed:issues", code: "UNAVAILABLE" }])
  assert.equal(first.more, false)

  failing = false
  const second = await providerWithFailure.page({ account: "work", request: request({ cursor: first.cursor }), now: NOW, call: toolCall("work") })
  assert.deepEqual(second.events.map((event) => event.external_id), ["ENG-103@2026-11-22T08:00:00.000Z", "ENG-102@2026-11-23T09:30:00.000Z", "ENG-101@2026-11-24T10:00:00.000Z"])
  assert.equal(second.failed, undefined)
})

test("both feeds failing refuses the call instead of answering an empty page", async () => {
  const broken = createProvider({
    plugin: "linear",
    package: "@we-the-rebel-alliance/linear-plugin",
    read: async () => {
      throw new SourceError({ code: "UNAVAILABLE", what: "Linear is unreachable", next: "Try again." })
    },
  })
  assert.equal(await refusalCode(() => broken.page({ account: "work", request: request({ since }), now: NOW, call: toolCall("work") })), "UNAVAILABLE")
})

test("a cursor that ends on one of two events at the same timestamp lists the other, never skips it", async () => {
  const stamp = "2026-11-23T09:30:00.000Z"
  const issue = (identifier: string) => ({
    id: identifier,
    uuid: `uuid-${identifier}`,
    title: `Issue ${identifier}`,
    description: "",
    url: `https://linear.app/acme/issue/${identifier}/same-time`,
    updatedAt: stamp,
    status: "Todo",
    statusType: "unstarted",
    priority: { name: "No priority" },
    labels: [],
    assignee: { id: "U-ACME-ADA", name: "Ada Lane" },
    assigneeId: "U-ACME-ADA",
    createdBy: { id: "U-ACME-ADA", name: "Ada Lane" },
    createdById: "U-ACME-ADA",
  })
  const items = [issue("SAME-1"), issue("SAME-2")]
  // Linear answers newest first; this fake pages one item at a time, so the pair also straddles a provider page.
  const sameTime = createProvider({
    plugin: "linear",
    package: "@we-the-rebel-alliance/linear-plugin",
    read: async (account, tool, input, call) => {
      if (tool === "list_issues") {
        const start = typeof input["cursor"] === "string" ? Number(input["cursor"]) : 0
        const next = start + 1
        return { issues: items.slice(start, next), hasNextPage: next < items.length, ...(next < items.length ? { cursor: String(next) } : {}) }
      }
      if (tool === "get_notifications") return { notifications: [], hasNextPage: false }
      return fakeRead(account, tool, input, call)
    },
  })
  const first = await sameTime.page({ account: "work", request: request({ since: Date.parse("2026-11-01T00:00:00.000Z"), limit: 1 }), now: NOW, call: toolCall("work") })
  assert.deepEqual(first.events.map((event) => event.external_id), ["SAME-1@2026-11-23T09:30:00.000Z"])
  assert.equal(first.more, true)
  const second = await sameTime.page({ account: "work", request: request({ cursor: first.cursor, limit: 1 }), now: NOW, call: toolCall("work") })
  assert.deepEqual(second.events.map((event) => event.external_id), ["SAME-2@2026-11-23T09:30:00.000Z"])
  assert.equal(second.more, false)
})

test("an account the fake does not hold is refused", async () => {
  assert.equal(await refusalCode(() => provider.page({ account: "team", request: request(), now: NOW, call: toolCall("team") })), "ACCOUNT_UNKNOWN")
  assert.equal(await refusalCode(() => provider.probe("team", toolCall("team"))), "ACCOUNT_UNKNOWN")
})

test("probe reads the owner and workspace and no content", async () => {
  assert.deepEqual(await provider.probe("personal", toolCall("personal")), {
    source: SOURCE,
    account: "personal",
    owner: { id: "mailto:ada@personal.example", label: "Ada Lane (studio)" },
    trust: "untrusted",
  })
})

test("the issues snapshot is a list of the assigned issues, done rows marked", async () => {
  const snapshot = await provider.issues({ account: "work", now: NOW, call: toolCall("work") })
  assert.equal(snapshot.account, "work")
  assert.equal(snapshot.trust, "untrusted")
  assert.deepEqual(snapshot.data.items, [
    { id: "ENG-101", text: "Queue migration", note: "In Progress" },
    { id: "ENG-102", text: "Rehearsal notes", note: "Done", done: true },
    { id: "ENG-103", text: "Handover", note: "Backlog" },
    { id: "ENG-104", text: "A pasted key", note: "Todo" },
  ])
})

test("the issues snapshot is accepted by the consumer check", async () => {
  const source = findSource(manifest, "linear.issues")
  assert.ok(source !== undefined)
  const accepted = acceptAnswer(source, "work", await provider.issues({ account: "work", now: NOW, call: toolCall("work") }))
  if (!accepted.ok) throw new Error(accepted.failure.message)
  assert.equal(accepted.kind, "snapshot")
})
