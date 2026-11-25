// The source contract's conformance kit over the source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against recorded Linear answers (test/fixtures/sources.json, all
// invented, and a bulk change of 2,600 issues made from it here): no Linear call, no sign-in. The reads go through a fake of OpenCode's executor that asserts
// `linear_<tool>` on the kit's recording permission, as the host asserts it, so the kit sees exactly what each read
// asserts. The report is written to reports/conformance-report.json, for a release to attach.
import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { declarationProblems, sourceConformance, type ConformanceReport, type PageCase, type SessionContext } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { LINEAR_SOURCE, NAMESPACE, PACKAGE, eventsMethod, probeMethod, signIns, type EventsToolOptions } from "../../src/events.js"
import { issuesMethod } from "../../src/issues.js"
import type { Status } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
/** The declaration as the contract's schema parses it, which is what the kit takes (source-contract#30, item 8). */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value
const source = sources.items.find((item) => item.id === `${NAMESPACE}.activity`)!
const tools = pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^linear\./, ""), readOnly: tool.readOnly }))
const LINEAR = JSON.parse(readFileSync(join(root, "test/fixtures/sources.json"), "utf8")) as Record<string, any>

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-11-01T00:00:00Z"
/** The account probe names: the workspace's id and the signed-in email. */
const ACCOUNT = `${LINEAR["workspace"].id}/${LINEAR["me"].email}`
/** Every event comes whole from a page of a list read, and any failed read fails the whole listing. */
const ATOMIC = "Each event comes whole from a list_issues or get_notifications page, never from a read of its own, and a failed read fails the whole listing, so no single event can fail on its own"
/**
 * A bulk change on 20 October: 2,600 of Sam's issues moved a second apart, more than one call reads (8 pages of 250, and a
 * ninth still full of them).
 * It is older than every case's since, so only a consumer whose cursor is from before it meets it: the cursor's history
 * is then out of reach, and the source answers an expired gap. No noExpiry: Linear loses history a reader has not seen
 * (a burst past one call's reach, a deleted issue, an inbox item removed), so the kit's expired-cursor check runs.
 */
const BULK = Array.from({ length: 2600 }, (_, n) => ({
  ...LINEAR["issues"][0],
  id: `ENG-${1000 + n}`,
  uuid: `0b5e0000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`,
  title: `Imported issue ${1000 + n}`,
  description: "Moved to the new board in the bulk change.",
  url: `https://linear.app/example-co/issue/ENG-${1000 + n}/imported-issue-${1000 + n}`,
  updatedAt: new Date(Date.parse("2026-10-20T09:00:00Z") + n * 1000).toISOString(),
}))
/**
 * 120 inbox notifications from the morning of 20 October, before the bulk change: they are older than the cut, so the
 * first pages of a read from before the bulk change list them, and none of the cut issues, while issues arrive.
 */
const EARLY_INBOX = Array.from({ length: 120 }, (_, n) => ({
  ...LINEAR["notifications"][0],
  id: `9a7d0000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`,
  createdAt: new Date(Date.parse("2026-10-20T06:00:00Z") + n * 1000).toISOString(),
}))
/** A consumer that last read on 19 October, before the bulk change: its cursor's history is out of reach. */
const BEFORE_BULK = Date.parse("2026-10-19T00:00:00Z")
const OLD = encodeBoundCursor({ plugin: NAMESPACE, source: LINEAR_SOURCE, account: ACCOUNT }, { a: ACCOUNT, i: [BEFORE_BULK, ""], n: [BEFORE_BULK, ""] })
/**
 * Issue changes that land while the bulk change is being read: one after each call from the first bulk case on, so the
 * kit's next read of a cut read meets an arrival, which must not cut it again (the cursor's fence).
 */
const ARRIVED: Record<string, unknown>[] = []
let arriving = false
const arrive = (input: Record<string, unknown>) => {
  if (input["cursor"] === OLD || input["since"] === new Date(BEFORE_BULK).toISOString()) arriving = true
  if (!arriving) return
  const n = ARRIVED.length
  ARRIVED.push({ ...LINEAR["issues"][0], id: `ENG-${5000 + n}`, uuid: `0b5e0000-0000-4000-8000-${String(5000 + n).padStart(12, "0")}`, title: `New issue ${5000 + n}`, url: `https://linear.app/example-co/issue/ENG-${5000 + n}/new-issue-${5000 + n}`, updatedAt: new Date(Date.parse("2026-11-08T11:00:00Z") + n * 1000).toISOString() })
}

const answer = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })

/**
 * OpenCode's executors for Linear's reads, answering as Linear does from the recorded data: assigned issues newest
 * first after `updatedAt`, notifications newest first, in pages of `limit` with Linear's cursor. Each asserts its own
 * `linear_<tool>` on the session's permission first, as the host does.
 */
function executors(permission: SessionContext["permission"]) {
  const paged = (key: string, items: unknown[], input: Record<string, unknown>) => {
    const from = Number(input["cursor"] ?? 0)
    const size = Number(input["limit"] ?? 50)
    const more = from + size < items.length
    return answer({ [key]: items.slice(from, from + size), hasNextPage: more, ...(more ? { cursor: String(from + size) } : {}) })
  }
  const newest = (field: string) => (a: Record<string, string>, b: Record<string, string>) => Date.parse(b[field]!) - Date.parse(a[field]!)
  const execute = (tool: string, input: Record<string, unknown>) => {
    if (tool === "linear_get_user") return answer(input["query"] === "me" ? LINEAR["me"] : {})
    if (tool === "linear_get_workspace") return answer(LINEAR["workspace"])
    if (tool === "linear_list_issues") {
      const raw = input["updatedAt"]
      const after = typeof raw === "string" ? Date.parse(raw) : Number.NaN
      const issues = [...LINEAR["issues"], ...BULK, ...ARRIVED].filter((item: { updatedAt: string }) => !Number.isFinite(after) || Date.parse(item.updatedAt) > after).sort(newest("updatedAt"))
      return paged("issues", issues, input)
    }
    return paged("notifications", [...LINEAR["notifications"], ...EARLY_INBOX].sort(newest("createdAt")), input)
  }
  return {
    list: async () =>
      ["linear_get_workspace", "linear_get_user", "linear_list_issues", "linear_get_notifications"].map((id) => ({
        id,
        execute: async (input: Record<string, unknown>) => {
          await permission.assert({ action: id, resources: ["*"] })
          return execute(id, input)
        },
      })),
  }
}

const connected = { state: "connected", nextStep: "Nothing to do." } as unknown as Status
const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: `script:${Math.random()}`, signal: new AbortController().signal, progress: async () => {} })
/** What probe records, for the one sign-in: a listing checks its account against it, as the plugin does. */
const known = signIns()
const options = (context: SessionContext): EventsToolOptions => ({
  tool: executors(context.permission) as never,
  permission: context.permission as never,
  owned: () => true,
  status: async () => connected,
  signIn: async () => "cred_conformance",
  signIns: known,
  now: () => NOW,
})
const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => {} } }
const list = (input: Record<string, unknown>, context: SessionContext = open) => eventsMethod(options(context)).run(input, call()) as Promise<Record<string, any>>

async function cases(): Promise<PageCase[]> {
  // A consumer probes at bind: the plugin then knows who the sign-in is, and a listing for that account runs.
  await probeMethod(options(open)).run({ source: LINEAR_SOURCE }, call())
  const first = (await list({ source: LINEAR_SOURCE, account: ACCOUNT, since: SINCE, limit: 2 }))["cursor"] as string
  const done = (await list({ source: LINEAR_SOURCE, account: ACCOUNT, cursor: first, limit: 500 }))["cursor"] as string
  return [
    { name: "a first listing, one issue refused for a secret", input: { source: LINEAR_SOURCE, account: ACCOUNT, since: SINCE }, expect: "page" },
    { name: "two at a time", input: { source: LINEAR_SOURCE, account: ACCOUNT, since: SINCE, limit: 2 }, expect: "page" },
    { name: "what came after the first two", input: { source: LINEAR_SOURCE, account: ACCOUNT, cursor: first }, expect: "page" },
    { name: "nothing new since the last listing", input: { source: LINEAR_SOURCE, account: ACCOUNT, cursor: done }, expect: "empty" },
    { name: "a listing that names no account", input: { source: LINEAR_SOURCE, since: SINCE }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a cursor passed for another account", input: { source: LINEAR_SOURCE, account: `${LINEAR["workspace"].id}/ama.mensah@example.com`, cursor: first }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "another account than the signed-in one", input: { source: LINEAR_SOURCE, account: `${LINEAR["workspace"].id}/someone.else@example.com`, since: SINCE }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "the same email in another workspace", input: { source: LINEAR_SOURCE, account: `0ff1ce00-0000-4000-8000-000000000000/${LINEAR["me"].email}`, since: SINCE }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    {
      name: "a cursor bound to another plugin",
      input: { source: LINEAR_SOURCE, account: ACCOUNT, cursor: encodeBoundCursor({ plugin: "jira", source: LINEAR_SOURCE, account: ACCOUNT }, { a: ACCOUNT, i: [0, ""], n: [0, ""] }) },
      expect: { refuses: "CURSOR_INVALID" },
    },
    { name: "a source this plugin does not have", input: { source: "jira", account: ACCOUNT }, expect: { refuses: "SOURCE_UNKNOWN" } },
    // Last, because an issue arrives after each of their calls (ARRIVED): the kit reads the page each cursor names
    // with the arrival in Linear, and checks that the read neither expires again nor repeats its gap.
    { name: "a cursor from before a bulk change bigger than one call reads: expired, once", input: { source: LINEAR_SOURCE, account: ACCOUNT, cursor: OLD }, expect: "expired" },
    {
      name: "a since from before the bulk change: window-truncated once, and not on the page its cursor names",
      input: { source: LINEAR_SOURCE, account: ACCOUNT, since: new Date(BEFORE_BULK).toISOString(), limit: 50 },
      expect: "page",
    },
  ]
}

/**
 * v0.3 checks this source carries nothing for. The kit marks each not applicable on its own; an empty reason would be
 * no reason, so each states why.
 */
const ABSENT = {
  "actor-kind": "the fixture names no machine actor, so actor-kind does not apply",
  "commitment-key": "no page carries a commitment, so commitment-key does not apply",
  facts: "no page carries a fact, so facts does not apply",
  hints: "the source declares no hint file, so hints does not apply",
  "parts-stable": "no page carries a part, so parts-stable does not apply",
  routines: "the source declares no routine file, so routines does not apply",
}

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  test("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => item.id)).toEqual(["linear.activity", "linear.issues"])
    expect(sources.items.find((item) => item.id === "linear.issues")).toMatchObject({ kind: "snapshot", output: "list", tool: "issues" })
  })

  test("linear.activity keeps the contract", async () => {
    const report = await sourceConformance({
      plugin: PACKAGE,
      source,
      tools,
      calls: {
        list: async (input, context) => {
          const page = await list(input, context)
          arrive(input)
          return page
        },
        probe: (input, context) => probeMethod(options(context)).run(input, call()),
      },
      cases: await cases(),
      account: ACCOUNT,
      sources,
      describe: { id: TOOLS_RPC_ID },
      atomicPages: { reason: ATOMIC },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    // Every check that applies runs, so the report is complete. The expired-cursor check and gap-once-per-read run on
    // the bulk change; failed-holds-cursor is not applicable with the reason above; the others not run are about what
    // this source never declares or sends: removals[], a price, details, suggest, a snapshot's output. The v0.3 checks
    // in `absent` do not apply either: each reason is non-empty, which is what the kit accepts for a stated skip.
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    expect(report.checks.filter((check) => check.notApplicable).map((check) => check.name).sort()).toEqual([
      "actor-kind",
      "billed-cost",
      "commitment-key",
      "details",
      "facts",
      "failed-holds-cursor",
      "hints",
      "output-schema",
      "parts-stable",
      "removals-are-final",
      "routines",
      "suggest",
    ])
    for (const [name, reason] of Object.entries(ABSENT)) {
      expect(reason.trim()).not.toBe("")
      expect(report.checks.find((check) => check.name === name)).toMatchObject({ ran: false, notApplicable: true, problems: [] })
    }
    for (const name of ["gap-and-cursor-expired", "gap-once-per-read"]) expect(report.checks.find((check) => check.name === name)).toMatchObject({ ran: true, notApplicable: false, problems: [] })
    expect(ARRIVED.length).toBeGreaterThan(1)
    expect(report.ok).toBe(true)
  })

  test("linear.issues keeps the contract", async () => {
    const listed = sources.items.find((item) => item.id === "linear.issues")!
    const report = await sourceConformance({
      plugin: PACKAGE,
      source: listed,
      tools,
      calls: {
        snapshot: (input, context) =>
          issuesMethod({
            tool: executors(context.permission) as never,
            owned: () => true,
            status: async () => connected,
            permission: context.permission as never,
            // The kit runs `probe` before the snapshot, as a consumer binds, so the identity is already known: a
            // content read makes no identity read of its own.
            signIn: async () => "cred_conformance",
            signIns: known,
          }).run(input, call()),
        probe: (input, context) => probeMethod(options(context)).run(input, call()),
      },
      snapshotCases: [{ ...(listed.input ?? {}), account: ACCOUNT }],
      cases: [],
      account: ACCOUNT,
      sources,
      describe: { id: TOOLS_RPC_ID },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.incomplete).toBe(false)
  })

  test("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source).sort()).toEqual(["linear.activity", "linear.issues"])
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: "@we-the-rebel-alliance/source-contract@0.3.0",
      plugin: PACKAGE,
      version: pkg.version,
      descriptorHash: installed.ok ? installed.value.hash : null,
      ok: reports.every((entry) => entry.ok),
      sources: reports,
    }
    mkdirSync(join(root, "reports"), { recursive: true })
    writeFileSync(join(root, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  })
})
