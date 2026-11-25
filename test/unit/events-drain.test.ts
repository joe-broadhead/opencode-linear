// linear.activity's cut-and-gap while a read drains: the review of #27's probes (e8d86ed), kept as regression tests
// with the fixed expectations. A cut answers one gap, and its cursor carries a fence, so an arrival during the drain
// never cuts the read again nor skips anything after the gap's since. All data invented.
import { describe, expect, test } from "bun:test"
import { resultProblems, type EventsListInput, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { checkHost } from "../../src/host-version.js"
import { eventsTool, signIns, type EventsToolOptions } from "../../src/events.js"
import { buildStatus, type StatusFacts } from "../../src/status.js"

const NOW = Date.parse("2026-11-08T12:00:00Z")
const SINCE = "2026-11-01T00:00:00Z"
const ME = "4f1c2e9a-0000-4000-8000-000000000001"
const WORKSPACE = "c0ffee00-0000-4000-8000-000000000000"
const ACCOUNT = `${WORKSPACE}/sam.rivera@example.com`
const OWNER = { id: `linear:${ME}`, label: "Sam Rivera (acme)" }

const issue = (n: number, updatedAt: string) => ({
  id: `ENG-${n}`,
  uuid: `0b5e0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Synthetic issue ${n}`,
  url: `https://linear.app/acme/issue/ENG-${n}`,
  updatedAt,
  assigneeId: ME,
})
const note = (n: number, createdAt: string) => ({
  id: `9a7d0000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  type: "issueComment",
  createdAt,
  issue: { identifier: `ENG-${n}`, title: `Synthetic issue ${n}`, url: `https://linear.app/acme/issue/ENG-${n}` },
})
const noteId = (n: number) => `notification:${note(n, "").id}`

type Data = { issues: ReturnType<typeof issue>[]; notifications: ReturnType<typeof note>[] }

/** Linear as the PR's own unit fake models it: newest first, offset cursors, pages of `pageSize`. */
function linear(data: Data, pageSize: number) {
  const calls: string[] = []
  const pages = <T>(items: T[], input: Record<string, unknown>, key: string) => {
    const from = Number(input["cursor"] ?? 0)
    const size = Math.min(pageSize, Number(input["limit"] ?? 50))
    const next = from + size < items.length
    return { [key]: items.slice(from, from + size), hasNextPage: next, ...(next ? { cursor: String(from + size) } : {}) }
  }
  const answers: Record<string, (input: Record<string, unknown>) => unknown> = {
    list_issues: (input) => {
      const after = Date.parse(String(input["updatedAt"]))
      return pages(data.issues.filter((i) => Date.parse(i.updatedAt) > after).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), input, "issues")
    },
    get_notifications: (input) => pages([...data.notifications].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), input, "notifications"),
  }
  const list = async () =>
    Object.entries(answers).map(([tool, answer]) => ({
      id: `linear_${tool}`,
      execute: async (input: Record<string, unknown>) => {
        calls.push(tool)
        return { output: answer(input) }
      },
    }))
  return { tool: { list: list as never }, calls, data }
}

const facts: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: "https://mcp.linear.app/mcp" }, access: "read-only", host: checkHost("2.4.1", false) }
const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never
function run(host: ReturnType<typeof linear>) {
  const known = signIns()
  known.set("cred_1", { account: ACCOUNT, owner: OWNER })
  const options: EventsToolOptions = { tool: host.tool, permission: { assert: async () => {} }, owned: () => true, status: async () => buildStatus(facts), signIn: async () => "cred_1", signIns: known, now: () => NOW }
  const tool = eventsTool(options)
  return async (input: EventsListInput): Promise<EventsListResult> => (await tool.execute({ account: ACCOUNT, ...input }, context)).output
}

/** Drain a read; `between` runs before every follow-up call (a new arrival in Linear). */
async function drain(list: (i: EventsListInput) => Promise<EventsListResult>, first: EventsListInput, between: (n: number) => void = () => {}) {
  const pages = [await list(first)]
  while (pages.at(-1)!.more) {
    if (pages.length > 60) throw new Error("does not drain")
    between(pages.length)
    pages.push(await list({ cursor: pages.at(-1)!.cursor, limit: first.limit }))
  }
  return pages
}
const ids = (pages: EventsListResult[]) => pages.flatMap((p) => p.events.map((e) => e.external_id))
const gaps = (pages: EventsListResult[]) => pages.flatMap((p, n) => (p.gap ? [{ page: n, ...p.gap }] : []))

describe("a read that drains after a cut", () => {
  test("CONTROL: a cut inbox drains with one gap when nothing new arrives mid-read", async () => {
    // Pages of 1: the inbox cap is 5 notifications per call. 8 notifications after since; 7 older issue changes fill
    // the first pages, so the restart page lists no notification (GitHub #31 MEDIUM 1's shape).
    const data: Data = {
      issues: Array.from({ length: 7 }, (_, n) => issue(100 + n, `2026-11-02T10:0${n}:00.000Z`)),
      notifications: Array.from({ length: 8 }, (_, n) => note(30 + n, `2026-11-05T08:0${n}:00.000Z`)),
    }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 2 })
    expect(gaps(pages)).toEqual([{ page: 0, reason: "window-truncated", since: "2026-11-05T08:03:00.001Z" }])
    expect(ids(pages).filter((id) => id.startsWith("notification:"))).toEqual([34, 35, 36, 37].map(noteId))
    for (const p of pages) expect(resultProblems(p, 2)).toEqual([])
  })

  test("one new notification mid-read: still one gap, and everything after its since is listed, the arrival too", async () => {
    const data: Data = {
      issues: Array.from({ length: 7 }, (_, n) => issue(100 + n, `2026-11-02T10:0${n}:00.000Z`)),
      notifications: Array.from({ length: 8 }, (_, n) => note(30 + n, `2026-11-05T08:0${n}:00.000Z`)),
    }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 2 }, (n) => {
      if (n === 1) data.notifications.push(note(90, "2026-11-08T11:00:00.000Z"))
    })
    const listed = ids(pages)
    // The gap promised everything from 08:03:00.001 on: notifications 34 to 37 and the arrival, each once.
    expect(gaps(pages)).toEqual([{ page: 0, reason: "window-truncated", since: "2026-11-05T08:03:00.001Z" }])
    expect(listed.filter((id) => id.startsWith("notification:"))).toEqual([34, 35, 36, 37, 90].map(noteId))
    expect(new Set(listed).size).toBe(listed.length)
    for (const p of pages) expect(resultProblems(p, 2)).toEqual([])
  })

  test("the same with assigned issues: one gap, the burst after its since and the arrival all listed", async () => {
    // Pages of 1: the issue cap is 8 per call. 12 burst changes; 4 older notifications fill the first pages.
    const data: Data = {
      issues: Array.from({ length: 12 }, (_, n) => issue(100 + n, `2026-11-02T10:${String(n).padStart(2, "0")}:00.000Z`)),
      notifications: Array.from({ length: 4 }, (_, n) => note(30 + n, `2026-11-01T05:0${n}:00.000Z`)),
    }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 1 }, (n) => {
      if (n === 1) data.issues.push(issue(500, "2026-11-08T10:00:00.000Z"))
    })
    const listed = ids(pages)
    // The cap of 8 reaches back to 10:04, so everything after 10:04 is promised, and listed.
    expect(gaps(pages)).toEqual([{ page: 0, reason: "window-truncated", since: "2026-11-02T10:04:00.001Z" }])
    const burst = Array.from({ length: 7 }, (_, n) => `ENG-${105 + n}@2026-11-02T10:${String(5 + n).padStart(2, "0")}:00.000Z`)
    expect(listed.filter((id) => id.startsWith("ENG-"))).toEqual([...burst, "ENG-500@2026-11-08T10:00:00.000Z"])
    expect(new Set(listed).size).toBe(listed.length)
  })

  test("an arrival before every call of the drain, in both feeds at once, never cuts the read again", async () => {
    const data: Data = {
      issues: Array.from({ length: 12 }, (_, n) => issue(100 + n, `2026-11-02T10:${String(n).padStart(2, "0")}:00.000Z`)),
      notifications: Array.from({ length: 8 }, (_, n) => note(30 + n, `2026-11-02T09:0${n}:00.000Z`)),
    }
    let arrival = 0
    // Two arrive before each call and four are listed per call, so the read catches up.
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 4 }, () => {
      arrival++
      data.issues.push(issue(600 + arrival, `2026-11-08T10:${String(arrival).padStart(2, "0")}:00.000Z`))
      data.notifications.push(note(700 + arrival, `2026-11-08T11:${String(arrival).padStart(2, "0")}:00.000Z`))
    })
    expect(gaps(pages)).toHaveLength(1)
    const listed = ids(pages)
    expect(new Set(listed).size).toBe(listed.length)
    // Every arrival is listed, once, in both feeds, and the read ends.
    expect(listed.filter((id) => id.startsWith("ENG-6"))).toHaveLength(arrival)
    expect(listed.filter((id) => id.startsWith("notification:9a7d0000-0000-4000-8000-0000000007"))).toHaveLength(arrival)
    expect(pages.at(-1)!.more).toBe(false)
  })

  test("more arrivals during the drain than one call reads are a new burst: a new gap, and the read still ends", async () => {
    const data: Data = { issues: Array.from({ length: 12 }, (_, n) => issue(100 + n, `2026-11-02T10:${String(n).padStart(2, "0")}:00.000Z`)), notifications: [] }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 2 }, (n) => {
      if (n === 1) data.issues.push(...Array.from({ length: 10 }, (_, k) => issue(800 + k, `2026-11-08T10:${String(k).padStart(2, "0")}:00.000Z`)))
    })
    expect(gaps(pages).map((gap) => gap.reason)).toEqual(["window-truncated", "expired"])
    expect(pages.at(-1)!.more).toBe(false)
  })

  /** A time `ms` before the fake clock's now: the lookback is for writes stamped in the last two minutes of wall time. */
  const ago = (ms: number) => new Date(NOW - ms).toISOString()

  test("a late arrival (round 1's FALSIFY 3, live): a change stamped a moment before the cursor, visible only after the read, is listed once", async () => {
    const data: Data = { issues: [issue(1, ago(30_000))], notifications: [] }
    const host = linear(data, 50)
    const first = await run(host)({ since: SINCE })
    expect(first.events).toHaveLength(1)
    // A concurrent write stamped 200 ms earlier commits after the read.
    data.issues.push(issue(2, ago(30_200)))
    const next = await run(host)({ cursor: first.cursor })
    expect(next.events.map((event) => event.external_id)).toEqual([`ENG-2@${ago(30_200)}`])
    expect(next.gap).toBeUndefined()
    // Listed once: the next read names neither again.
    const after = await run(host)({ cursor: next.cursor })
    expect(after).toMatchObject({ events: [], more: false })
  })

  test("late arrivals in both feeds stamped in Linear's last two minutes are listed once; older is the stated assumption", async () => {
    const data: Data = { issues: [issue(1, ago(10_000))], notifications: [note(1, ago(10_000))] }
    const host = linear(data, 2)
    const first = await run(host)({ since: SINCE })
    expect(first.events).toHaveLength(2)
    // Linear's now is its newest stamp, 10 s ago: the lookback reaches back to 130 s ago.
    data.issues.push(issue(2, ago(100_000)), issue(3, ago(135_000)))
    data.notifications.push(note(2, ago(10_001)), note(3, ago(140_000)))
    const next = await run(host)({ cursor: first.cursor })
    expect(next.events.map((event) => event.external_id).sort()).toEqual([`ENG-2@${ago(100_000)}`, noteId(2)].sort())
    const after = await run(host)({ cursor: next.cursor })
    expect(after).toMatchObject({ events: [], more: false })
  })

  test("a backlog read far behind now re-reads nothing: the position is older than any write still unseen", async () => {
    const data: Data = { issues: [issue(1, "2026-11-03T09:00:00.500Z")], notifications: [] }
    const host = linear(data, 50)
    const first = await run(host)({ since: SINCE })
    const state = JSON.parse(Buffer.from(first.cursor, "base64url").toString()) as { i: [number, string]; li: [number, string]; si: string }
    expect(state.li).toEqual(state.i)
    expect(state.si).toBe("")
  })

  test("a late arrival waiting behind a full page is listed on a later page, and nothing is listed twice", async () => {
    const data: Data = { issues: Array.from({ length: 5 }, (_, n) => issue(10 + n, ago(60_000 - n * 1000))), notifications: [] }
    const host = linear(data, 2)
    const pages = await drain(run(host), { since: SINCE, limit: 2 }, (n) => {
      if (n === 1) data.issues.push(issue(99, ago(59_500)))
    })
    const listed = ids(pages)
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed).toHaveLength(6)
    expect(listed).toContain(`ENG-99@${ago(59_500)}`)
  })

  test("an entry Linear answers without an id or a time holds only its feed: the other is listed, and with nothing else to list the call is UPSTREAM_UNREADABLE", async () => {
    for (const broken of ["issues", "notifications"] as const) {
      const data: Data = { issues: [issue(1, "2026-11-03T09:00:00.000Z")], notifications: [note(1, "2026-11-03T09:00:00.000Z")] }
      const host = linear(data, 50)
      const first = await run(host)({ since: SINCE })
      if (broken === "issues") data.issues.push({ ...issue(2, "2026-11-03T10:00:00.000Z"), id: undefined as never })
      else data.notifications.push({ ...note(2, "2026-11-03T10:00:00.000Z"), id: undefined as never })
      // The other feed has a new change: it is listed, and the broken feed's position is held.
      if (broken === "issues") data.notifications.push(note(3, "2026-11-03T11:00:00.000Z"))
      else data.issues.push(issue(3, "2026-11-03T11:00:00.000Z"))
      const next = await run(host)({ cursor: first.cursor })
      expect({ broken, listed: next.events.map((event) => event.external_id) }).toEqual({ broken, listed: [broken === "issues" ? noteId(3) : "ENG-3@2026-11-03T11:00:00.000Z"] })
      const firstState = JSON.parse(Buffer.from(first.cursor, "base64url").toString()) as Record<string, unknown>
      const nextState = JSON.parse(Buffer.from(next.cursor, "base64url").toString()) as Record<string, unknown>
      const held = broken === "issues" ? "i" : "n"
      expect(nextState[held]).toEqual(firstState[held])
      // Nothing else to list: the call says so, loudly, and names the tool.
      await expect(run(host)({ cursor: next.cursor })).rejects.toThrow(/^UPSTREAM_UNREADABLE: Linear's (list_issues|get_notifications) answered an entry without an id or a time/)
    }
    // Both feeds broken: the call fails.
    const data: Data = { issues: [issue(1, "2026-11-03T09:00:00.000Z")], notifications: [note(1, "2026-11-03T09:00:00.000Z")] }
    const host = linear(data, 50)
    const first = await run(host)({ since: SINCE })
    data.issues.push({ ...issue(2, "2026-11-03T10:00:00.000Z"), id: undefined as never })
    data.notifications.push({ ...note(2, "2026-11-03T10:00:00.000Z"), id: undefined as never })
    await expect(run(host)({ cursor: first.cursor })).rejects.toThrow(/^UPSTREAM_UNREADABLE: /)
  })

  test("same-millisecond ties straddling Linear's pages at the cursor's millisecond are all listed once (limit 1..3)", async () => {
    for (const limit of [1, 2, 3]) {
      const at = "2026-11-03T08:00:00.000Z"
      const data: Data = { issues: Array.from({ length: 7 }, (_, n) => issue(200 + n, at)), notifications: Array.from({ length: 4 }, (_, n) => note(60 + n, at)) }
      const pages = await drain(run(linear(data, 2)), { since: SINCE, limit })
      const listed = ids(pages)
      expect(new Set(listed).size).toBe(listed.length)
      expect(listed).toHaveLength(11)
      expect(gaps(pages)).toEqual([])
    }
  })

  test("a tie bigger than one call (all 20 issues at one ms, cap 8) is passed whole with one gap and the cursor moves on", async () => {
    const at = "2026-11-03T08:00:00.000Z"
    const data: Data = { issues: [...Array.from({ length: 20 }, (_, n) => issue(300 + n, at)), issue(9, "2026-11-04T08:00:00.000Z")], notifications: [] }
    const host = linear(data, 1)
    const pages = await drain(run(host), { since: SINCE, limit: 1 })
    expect(gaps(pages)).toEqual([{ page: 0, reason: "window-truncated", since: "2026-11-03T08:00:00.001Z" }])
    expect(ids(pages)).toEqual(["ENG-9@2026-11-04T08:00:00.000Z"])
    const again = await run(host)({ cursor: pages.at(-1)!.cursor })
    expect(again.events).toEqual([])
    expect(again.gap).toBeUndefined()
  })
})
