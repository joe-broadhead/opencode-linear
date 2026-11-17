// The three bugs every review of a source keeps finding (the sliding gap, the jam, gap once per read), at Linear's real
// page sizes and in a fuzz with heavy ties, uneven pages and arrivals: the re-review of #27's round-3 probes (a14b6dd),
// kept as regression tests, plus late arrivals inside the lookback and an item Linear's pages show twice. All data
// invented.
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
const iso = (t: number) => new Date(t).toISOString()

type Issue = { id: string; uuid: string; title: string; url: string; updatedAt: string; assigneeId: string }
type Note = { id: string; type: string; createdAt: string; issue: { identifier: string; title: string; url: string } }
const issue = (n: number, t: number): Issue => ({ id: `ENG-${n}`, uuid: `0b5e0000-0000-4000-8000-${String(n).padStart(12, "0")}`, title: `Synthetic ${n}`, url: `https://linear.app/acme/issue/ENG-${n}`, updatedAt: iso(t), assigneeId: ME })
const note = (n: number, t: number): Note => ({ id: `9a7d0000-0000-4000-8000-${String(n).padStart(12, "0")}`, type: "issueComment", createdAt: iso(t), issue: { identifier: `ENG-${n}`, title: `Synthetic ${n}`, url: `https://linear.app/acme/issue/ENG-${n}` } })
const issueKey = (i: Issue) => `${i.id}@${i.updatedAt}`
const noteKey = (n: Note) => `notification:${n.id}`
type Data = { issues: Issue[]; notifications: Note[] }

/** Linear as the PR's fake models it: newest first (ties in insertion order), offset cursors, pages of `pageSize`. */
function linear(data: Data, pageSize: number, midCall?: (tool: string, page: number) => void, lengthOf?: () => number) {
  const calls: string[] = []
  const pages = <T>(items: T[], input: Record<string, unknown>, key: string) => {
    const from = Number(input["cursor"] ?? 0)
    const size = Math.min(lengthOf ? lengthOf() : pageSize, pageSize, Number(input["limit"] ?? 50))
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
        const out = answer(input)
        midCall?.(tool, Number(input["cursor"] ?? 0))
        return { output: out }
      },
    }))
  return { tool: { list: list as never }, calls, data }
}

const facts: StatusFacts = { server: { status: "connected" }, source: { type: "plugin", url: "https://mcp.linear.app/mcp" }, access: "read-only", host: checkHost("2.2.3", false) }
const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal } as never
function run(host: ReturnType<typeof linear>) {
  const known = signIns()
  known.set("cred_1", { account: ACCOUNT, owner: OWNER })
  const options: EventsToolOptions = { tool: host.tool, permission: { assert: async () => {} }, owned: () => true, status: async () => buildStatus(facts), signIn: async () => "cred_1", signIns: known, now: () => NOW }
  const tool = eventsTool(options)
  return async (input: EventsListInput): Promise<EventsListResult> => (await tool.execute({ account: ACCOUNT, ...input }, context)).output
}

async function drain(list: (i: EventsListInput) => Promise<EventsListResult>, first: EventsListInput, between: (n: number) => void = () => {}, max = 2000) {
  const pages = [await list(first)]
  while (pages.at(-1)!.more) {
    if (pages.length > max) throw new Error("does not drain")
    between(pages.length)
    pages.push(await list({ cursor: pages.at(-1)!.cursor, limit: first.limit }))
  }
  return pages
}
const ids = (pages: EventsListResult[]) => pages.flatMap((p) => p.events.map((e) => e.external_id))
const gaps = (pages: EventsListResult[]) => pages.flatMap((p, n) => (p.gap ? [{ page: n, ...p.gap }] : []))
/** Every item after the (single) gap's since, or after since when there is no gap, that exists at the end. */
function owed(data: Data, sinceIso: string) {
  const s = Date.parse(sinceIso)
  return [...data.issues.filter((i) => Date.parse(i.updatedAt) >= s).map(issueKey), ...data.notifications.filter((n) => Date.parse(n.createdAt) >= s).map(noteKey)]
}

const T0 = Date.parse("2026-11-02T10:00:00Z")
const MIN = 60_000
const DAY = 86_400_000


const after = (t: number, k: string, p: [number, string]) => t > p[0] || (t === p[0] && k > p[1])
/** Unseen per feed at a cursor: items strictly after the feed's position. */
function unseenAt(data: Data, cursor: string | undefined) {
  if (!cursor) return { i: Infinity, n: Infinity }
  const s = JSON.parse(Buffer.from(cursor, "base64url").toString()) as { i: [number, string]; n: [number, string] }
  return { i: data.issues.filter((x) => after(Date.parse(x.updatedAt), issueKey(x), s.i)).length, n: data.notifications.filter((x) => after(Date.parse(x.createdAt), noteKey(x), s.n)).length }
}
const latest = (g: { since: string }[]) => iso(Math.max(...g.map((x) => Date.parse(x.since))))
const SLOW = 600_000

describe("the recurring bugs, and late arrivals", () => {
  test("J1 jam: 5,000 tied in both feeds (one ms), real page sizes, limit 100: one gap, cut whole, later items listed, next read quiet", async () => {
    const tie = T0 + DAY
    const data: Data = {
      issues: [...Array.from({ length: 10 }, (_, n) => issue(50 + n, T0 + n * MIN)), ...Array.from({ length: 5000 }, (_, n) => issue(10000 + n, tie)), ...Array.from({ length: 10 }, (_, n) => issue(70 + n, tie + (n + 1) * MIN))],
      notifications: [...Array.from({ length: 10 }, (_, n) => note(50 + n, T0 + n * MIN)), ...Array.from({ length: 5000 }, (_, n) => note(10000 + n, tie)), ...Array.from({ length: 10 }, (_, n) => note(70 + n, tie + (n + 1) * MIN))],
    }
    const host = linear(data, 250)
    const pages = await drain(run(host), { since: SINCE, limit: 100 })
    const g = gaps(pages)
    const listed = ids(pages)
    expect(g.map((x) => x.page)).toEqual([0])
    expect(new Set(listed).size).toBe(listed.length)
    expect(owed(data, latest(g)).filter((k) => !listed.includes(k))).toEqual([])
    expect(listed).toHaveLength(20)
    const later = await run(host)({ cursor: pages.at(-1)!.cursor })
    expect({ n: later.events.length, gap: later.gap, more: later.more }).toEqual({ n: 0, gap: undefined, more: false })
  }, SLOW)

  test("J2 jam: 1,999 tied issues and 499 tied notifications, cursor part way through both, arrivals in each feed after every call (60 each): no gap, every item listed once", async () => {
    const data: Data = { issues: Array.from({ length: 1999 }, (_, n) => issue(10000 + n, T0)), notifications: Array.from({ length: 499 }, (_, n) => note(10000 + n, T0)) }
    let a = 0
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 100 }, () => {
      if (a < 60) { data.issues.push(issue(90000 + a, NOW + a * MIN)); data.notifications.push(note(90000 + a, NOW + a * MIN + 1)); a++ }
    })
    const listed = ids(pages)
    expect(gaps(pages)).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed).toHaveLength(1999 + 499 + 2 * a)
  }, SLOW)

  test("J3 (info) a tie the cursor is part way through plus a true overflow of arrivals: honest gap, everything after since listed", async () => {
    const data: Data = { issues: Array.from({ length: 1999 }, (_, n) => issue(10000 + n, T0)), notifications: [] }
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 100 }, (n) => {
      if (n === 1) for (let k = 0; k < 2100; k++) data.issues.push(issue(90000 + k, NOW + k * 1000))
    })
    const g = gaps(pages)
    const listed = ids(pages)
    expect(g.length).toBe(1)
    expect(new Set(listed).size).toBe(listed.length)
    expect(owed(data, latest(g)).filter((k) => !listed.includes(k))).toEqual([])
  }, SLOW)

  test("S1 sliding at real page sizes: 2,600 issues and 700 notifications cut, paused and resumed minutes and days later with 40 arrivals per feed each time: one gap, nothing after since skipped", async () => {
    const data: Data = {
      issues: Array.from({ length: 2600 }, (_, n) => issue(10000 + n, T0 + n * 1000)),
      notifications: Array.from({ length: 700 }, (_, n) => note(10000 + n, T0 + n * 3000 + 1)),
    }
    let clock = NOW, a = 0
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 50 }, (n) => {
      if (n % 5 === 0 && a < 400) {
        clock += n % 10 === 0 ? 2 * DAY : 7 * MIN
        for (let k = 0; k < 40; k++, a++) { data.issues.push(issue(90000 + a, clock + k * 1000)); data.notifications.push(note(90000 + a, clock + k * 1000 + 1)) }
      }
    })
    const g = gaps(pages)
    const listed = ids(pages)
    expect(g.map((x) => x.page)).toEqual([0])
    expect(new Set(listed).size).toBe(listed.length)
    expect(owed(data, latest(g)).filter((k) => !listed.includes(k))).toEqual([])
  }, SLOW)

  test("S2 re-read: the same mid-drain cursor read again minutes and days later, with arrivals, gives the same page and no gap", async () => {
    const data: Data = { issues: Array.from({ length: 2300 }, (_, n) => issue(10000 + n, T0 + n * 1000)), notifications: Array.from({ length: 600 }, (_, n) => note(10000 + n, T0 + n * 4000 + 1)) }
    const list = run(linear(data, 250))
    const first = await list({ since: SINCE, limit: 100 })
    const second = await list({ cursor: first.cursor, limit: 100 })
    const mid = await list({ cursor: second.cursor, limit: 100 })
    for (let k = 0; k < 30; k++) { data.issues.push(issue(90000 + k, NOW + k * MIN)); data.notifications.push(note(90000 + k, NOW + k * MIN + 1)) }
    const again = await list({ cursor: second.cursor, limit: 100 })
    for (let k = 30; k < 60; k++) { data.issues.push(issue(90000 + k, NOW + 3 * DAY + k * MIN)); data.notifications.push(note(90000 + k, NOW + 3 * DAY + k * MIN + 1)) }
    const days = await list({ cursor: second.cursor, limit: 100 })
    expect([second.gap, mid.gap, again.gap, days.gap]).toEqual([undefined, undefined, undefined, undefined])
    expect(again.events.map((e) => e.external_id)).toEqual(mid.events.map((e) => e.external_id))
    expect(days.events.map((e) => e.external_id)).toEqual(mid.events.map((e) => e.external_id))
    const rest = await drain(list, { cursor: days.cursor, limit: 100 })
    const listed = new Set([...ids([first, second, days]), ...ids(rest)])
    expect(gaps(rest)).toEqual([])
    expect(owed(data, first.gap!.since).filter((k) => !listed.has(k))).toEqual([])
  }, SLOW)

  test("G1 gap once per read across many small pages at real sizes, both feeds cut (limit 7)", async () => {
    const data: Data = { issues: Array.from({ length: 2400 }, (_, n) => issue(10000 + n, T0 + n * 1000)), notifications: Array.from({ length: 650 }, (_, n) => note(10000 + n, T0 + n * 1000 + 1)) }
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 7 })
    const g = gaps(pages)
    expect(g.map((x) => x.page)).toEqual([0])
    const listed = ids(pages)
    expect(new Set(listed).size).toBe(listed.length)
    expect(owed(data, latest(g)).filter((k) => !listed.includes(k))).toEqual([])
  }, SLOW)

  test("M1 one item arriving mid-read in each feed, alone and together, while both feeds are cut (real sizes)", async () => {
    for (const which of ["issues", "notifications", "both"] as const) {
      const data: Data = { issues: Array.from({ length: 2600 }, (_, n) => issue(10000 + n, T0 + n * 1000)), notifications: Array.from({ length: 700 }, (_, n) => note(10000 + n, T0 + n * 1000 + 1)) }
      const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 100 }, (n) => {
        if (n === 1 && which !== "notifications") data.issues.push(issue(99999, NOW))
        if (n === 1 && which !== "issues") data.notifications.push(note(99999, NOW + 1))
      })
      const g = gaps(pages)
      expect({ which, pages: g.map((x) => x.page) }).toEqual({ which, pages: [0] })
      const listed = new Set(ids(pages))
      expect(owed(data, latest(g)).filter((k) => !listed.has(k))).toEqual([])
    }
  }, SLOW)

  test("L1 a window item updated again during the drain (moves above the fence): its new version is listed, no second gap", async () => {
    const data: Data = { issues: Array.from({ length: 30 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: [] }
    const pages = await drain(run(linear(data, 2)), { since: SINCE, limit: 2 }, (n) => {
      if (n === 2) { const it = data.issues.find((x) => x.id === "ENG-125")!; it.updatedAt = iso(NOW + MIN) }
    })
    const g = gaps(pages)
    const listed = ids(pages)
    expect(g.map((x) => x.page)).toEqual([0])
    expect(listed).toContain(`ENG-125@${iso(NOW + MIN)}`)
    expect(new Set(listed).size).toBe(listed.length)
  }, SLOW)

  test("F1 fuzz with ties (few time slots), uneven Linear page lengths and arrivals: no duplicate, nothing after the latest since skipped, no gap at a cursor with unseen within one call's reach", async () => {
    let seed = 777
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pick = (n: number) => Math.floor(rnd() * n)
    const tally = { rounds: 0, multi: 0, spurious: 0, spuriousUneven: 0 }
    for (let round = 0; round < 600; round++) {
      const pageSize = 1 + pick(4)
      const uneven = pick(3) === 0
      const limit = [1, 2, 3, 5, 100][pick(5)]!
      const issueCap = 8 * pageSize, noteCap = 5 * pageSize
      const slots = 2 + pick(8)
      const data: Data = {
        issues: Array.from({ length: pick(issueCap * 2 + 3) }, (_, n) => issue(1000 + n, T0 + pick(slots) * MIN)),
        notifications: Array.from({ length: pick(noteCap * 2 + 3) }, (_, n) => note(5000 + n, T0 + pick(slots) * MIN)),
      }
      let ai = 0, an = 0, clock = NOW
      const base = run(linear(data, pageSize, undefined, uneven ? () => 1 + pick(pageSize) : undefined))
      const spurious: string[] = []
      const list = async (input: EventsListInput) => {
        const u = unseenAt(data, input.cursor)
        const page = await base(input)
        if (page.gap && input.cursor && u.i <= issueCap && u.n <= noteCap) spurious.push(JSON.stringify({ u, gap: page.gap }))
        return page
      }
      const pages = await drain(list, { since: SINCE, limit }, () => {
        clock += pick(2) ? MIN : DAY
        if (ai < issueCap - 2 && pick(3) === 0) data.issues.push(issue(20000 + ai++, clock))
        if (an < noteCap - 2 && pick(3) === 0) data.notifications.push(note(30000 + an++, clock + pick(2)))
      })
      const listed = ids(pages)
      const g = gaps(pages)
      tally.rounds++
      tally.multi += g.length > 1 ? 1 : 0
      if (spurious.length) uneven ? tally.spuriousUneven++ : tally.spurious++
      const ctx = { round, pageSize, uneven, limit, gaps: g }
      expect({ ...ctx, dup: listed.length - new Set(listed).size }).toEqual({ ...ctx, dup: 0 })
      const missed = owed(data, g.length ? latest(g) : SINCE).filter((k) => !listed.includes(k))
      expect({ ...ctx, missed }).toEqual({ ...ctx, missed: [] })
      if (!uneven) expect({ ...ctx, spurious }).toEqual({ ...ctx, spurious: [] })
      for (const p of pages) expect(resultProblems(p, limit)).toEqual([])
    }
  }, SLOW)

  test("F2 late arrivals up to 110 s behind each feed's position, in both feeds (within the 16 hashes a feed's lookback carries): each listed once, no gap, the cursor within 1,024 characters", async () => {
    let seed = 4242
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pick = (n: number) => Math.floor(rnd() * n)
    for (let round = 0; round < 200; round++) {
      const pageSize = 1 + pick(4)
      const limit = [1, 2, 3, 5, 100][pick(5)]!
      const data: Data = {
        issues: Array.from({ length: 1 + pick(4 * pageSize) }, (_, n) => issue(1000 + n, T0 + n * 3 * MIN)),
        notifications: Array.from({ length: 1 + pick(3 * pageSize) }, (_, n) => note(5000 + n, T0 + n * 3 * MIN + 1)),
      }
      const base = run(linear(data, pageSize))
      let current = ""
      const list = async (input: EventsListInput) => {
        const page = await base(input)
        current = page.cursor
        return page
      }
      let a = 0
      let ai = 0
      let an = 0
      // Before each call, maybe a late arrival in each feed, stamped up to 110 s before that feed's position; at most 8 a
      // feed, so a lookback never holds more than its 16 hashes (the hash-cap test covers more).
      const pages = await drain(list, { since: SINCE, limit }, () => {
        const state = JSON.parse(Buffer.from(current, "base64url").toString()) as { i: [number, string]; n: [number, string] }
        if (ai < 8 && pick(2) && state.i[0] > Date.parse(SINCE)) (ai++, data.issues.push(issue(70000 + a++, state.i[0] - pick(110_000))))
        if (an < 8 && pick(2) && state.n[0] > Date.parse(SINCE)) (an++, data.notifications.push(note(70000 + a++, state.n[0] - pick(110_000))))
      })
      // A last read after the drain finds any arrival the drain's last page left behind.
      let last = pages.at(-1)!
      const tail = [last]
      for (let k = 0; k < 200 && (k === 0 || last.more || last.events.length); k++) tail.push((last = await list({ cursor: last.cursor, limit })))
      expect(last).toMatchObject({ events: [], more: false })
      const all = [...pages, ...tail.slice(1)]
      const listed = ids(all)
      const ctx = { round, pageSize, limit }
      expect({ ...ctx, dup: listed.length - new Set(listed).size }).toEqual({ ...ctx, dup: 0 })
      expect({ ...ctx, gaps: gaps(all) }).toEqual({ ...ctx, gaps: [] })
      expect({ ...ctx, missed: owed(data, SINCE).filter((k) => !listed.includes(k)) }).toEqual({ ...ctx, missed: [] })
      for (const p of all) expect(p.cursor.length).toBeLessThanOrEqual(1024)
    }
  }, SLOW)

  test("the lookback carries at most 16 hashes a feed: past that it starts at the 17th newest listed, and the cursor stays within 1,024 characters", async () => {
    // 40 issues and 40 notifications a second apart: all inside two minutes.
    const data: Data = { issues: Array.from({ length: 40 }, (_, n) => issue(100 + n, T0 + n * 1000)), notifications: Array.from({ length: 40 }, (_, n) => note(100 + n, T0 + n * 1000 + 1)) }
    const host = linear(data, 250)
    const first = await run(host)({ since: SINCE, limit: 500 })
    expect(first.events).toHaveLength(80)
    expect(first.cursor.length).toBeLessThanOrEqual(1024)
    const state = JSON.parse(Buffer.from(first.cursor, "base64url").toString()) as { si: string; sn: string; li: [number, string] }
    expect([state.si.length, state.sn.length]).toEqual([16 * 8, 16 * 8])
    // The line is the 17th newest issue's millisecond: a late arrival after it is listed, one before it is the known limit.
    expect(state.li[0]).toBe(T0 + 23 * 1000)
    data.issues.push(issue(900, T0 + 30_500), issue(901, T0 + 10_500))
    const next = await run(host)({ cursor: first.cursor })
    expect(next.events.map((event) => event.external_id)).toEqual([`ENG-900@${iso(T0 + 30_500)}`])
  }, SLOW)

  test("R9 an item arriving between two of Linear's pages in one walk shifts the pages; it is listed once", async () => {
    const data: Data = { issues: Array.from({ length: 6 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: [] }
    let done = false
    const host = linear(data, 2, (tool, page) => {
      if (tool === "list_issues" && page === 0 && !done) {
        done = true
        data.issues.push(issue(999, NOW - MIN))
      }
    })
    const page = await run(host)({ since: SINCE, limit: 100 })
    const listed = ids([page])
    expect(listed.length - new Set(listed).size).toBe(0)
    expect(resultProblems(page, 100)).toEqual([])
    // The arrival itself is listed by the next read.
    const next = await run(host)({ cursor: page.cursor })
    expect(ids([page, next])).toContain(`ENG-999@${iso(NOW - MIN)}`)
  }, SLOW)
})
