// linear.activity's per-call caps: only unseen items count, so ties the cursor already listed and arrivals under one
// call's reach never cut a read, and a gap comes only when unseen items truly exceed the reach. The re-review of #27's
// probes (3aa2c53), kept as regression tests with the fixed expectations, at Linear's real page sizes too, and a seeded
// fuzz that checks every gap against what was unseen. All data invented.
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
function linear(data: Data, pageSize: number, midCall?: (tool: string, page: number) => void) {
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

/** These read thousands of items through the fake; a slow runner (macOS Intel) needs more than bun's 5 s. */
const SLOW = 60_000

describe("the per-call caps count only unseen items", () => {
  test("R1 (old FALSIFY 1): a notification arriving mid-read no longer cuts the inbox again", async () => {
    const data: Data = { issues: Array.from({ length: 7 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: Array.from({ length: 8 }, (_, n) => note(30 + n, T0 + 3 * DAY + n * MIN)) }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 2 }, (n) => {
      if (n === 1) data.notifications.push(note(90, NOW - MIN))
    })
    const g = gaps(pages)
    expect(g).toHaveLength(1)
    const listed = new Set(ids(pages))
    expect(owed(data, g[0]!.since).filter((k) => !listed.has(k))).toEqual([])
    expect(listed.size).toBe(ids(pages).length)
  }, SLOW)

  test("R2 (old FALSIFY 2): an issue arriving mid-read no longer cuts the burst again", async () => {
    const data: Data = { issues: Array.from({ length: 12 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: Array.from({ length: 4 }, (_, n) => note(30 + n, Date.parse(SINCE) + n * MIN)) }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 1 }, (n) => {
      if (n === 1) data.issues.push(issue(500, NOW - MIN))
    })
    const g = gaps(pages)
    expect(g).toHaveLength(1)
    const listed = new Set(ids(pages))
    expect(owed(data, g[0]!.since).filter((k) => !listed.has(k))).toEqual([])
  }, SLOW)

  test("R3 sliding: a cut read paused, resumed minutes then days later with arrivals in both feeds (fewer in total than one call reads): one gap, nothing after since skipped", async () => {
    for (const pageSize of [1, 2, 3]) {
      const data: Data = {
        issues: Array.from({ length: 8 * pageSize + 6 }, (_, n) => issue(100 + n, T0 + n * MIN)),
        notifications: Array.from({ length: 5 * pageSize + 4 }, (_, n) => note(300 + n, T0 + n * MIN + 30_000)),
      }
      const list = run(linear(data, pageSize))
      let clock = NOW
      let a = 0
      const pages = await drain(list, { since: SINCE, limit: 1 }, (n) => {
        // Every 3rd call: minutes later; every 7th: days later. Each time 1 issue and 1 notification arrive.
        if ((n % 3 === 0 || n % 7 === 0) && a < 5 * pageSize - 1) {
          clock += n % 7 === 0 ? 3 * DAY : 5 * MIN
          data.issues.push(issue(900 + a, clock))
          data.notifications.push(note(900 + a++, clock + 1))
        }
      })
      const g = gaps(pages)
      expect(g.map((gap) => gap.page)).toEqual([0])
      const listed = new Set(ids(pages))
      expect(owed(data, iso(Math.max(...g.map((x) => Date.parse(x.since))))).filter((k) => !listed.has(k))).toEqual([])
      expect(listed.size).toBe(ids(pages).length)
      for (const p of pages) expect(resultProblems(p, 1)).toEqual([])
    }
  }, SLOW)

  test("R4 sliding with re-reads: the same cursor read again minutes and days later never answers a gap it did not answer before", async () => {
    const data: Data = { issues: Array.from({ length: 14 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: [] }
    const list = run(linear(data, 1))
    const first = await list({ since: SINCE, limit: 2 })
    expect(first.gap?.reason).toBe("window-truncated")
    const second = await list({ cursor: first.cursor, limit: 2 })
    expect(second.gap).toBeUndefined()
    data.issues.push(issue(700, NOW + 10 * MIN))
    const again = await list({ cursor: first.cursor, limit: 2 }) // re-read of the same cursor, minutes later, with an arrival
    expect(again.gap).toBeUndefined()
    expect(again.events.map((e) => e.external_id)).toEqual(second.events.map((e) => e.external_id))
    data.issues.push(issue(701, NOW + 3 * DAY))
    const rest = await drain(list, { cursor: again.cursor, limit: 2 })
    expect(gaps(rest)).toEqual([])
    const listed = new Set([...ids([first, again]), ...ids(rest)])
    expect(owed(data, first.gap!.since).filter((k) => !listed.has(k))).toEqual([])
  }, SLOW)

  test("R5 a new burst bigger than one call's reach during a drain answers a second, honest gap; everything after it is listed", async () => {
    const data: Data = { issues: Array.from({ length: 12 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: [] }
    const pages = await drain(run(linear(data, 1)), { since: SINCE, limit: 1 }, (n) => {
      if (n === 2) for (let k = 0; k < 10; k++) data.issues.push(issue(800 + k, NOW + k * MIN))
    })
    const g = gaps(pages)
    expect(g.length).toBe(2)
    expect(g[1]!.reason).toBe("expired")
    const listed = new Set(ids(pages))
    expect(owed(data, g[1]!.since).filter((k) => !listed.has(k))).toEqual([])
  }, SLOW)

  test("R6 jam: same-millisecond bursts beyond a page in both feeds at once (at the cut, inside the window, at the cursor) never jam", async () => {
    for (const pageSize of [1, 2, 3]) {
      for (const limit of [1, 3, 500]) {
        const tieA = T0, tieB = T0 + 5 * MIN
        const data: Data = {
          issues: [...Array.from({ length: 30 }, (_, n) => issue(100 + n, tieA)), ...Array.from({ length: 2 * pageSize + 1 }, (_, n) => issue(200 + n, tieB)), issue(9, tieB + MIN)],
          notifications: [...Array.from({ length: 20 }, (_, n) => note(300 + n, tieA)), ...Array.from({ length: 2 * pageSize + 1 }, (_, n) => note(400 + n, tieB)), note(9, tieB + MIN)],
        }
        const host = linear(data, pageSize)
        const pages = await drain(run(host), { since: SINCE, limit })
        const listed = ids(pages)
        expect(new Set(listed).size).toBe(listed.length)
        const g = gaps(pages)
        expect(g.length).toBeLessThanOrEqual(1)
        if (g.length) expect(owed(data, g[0]!.since).filter((k) => !listed.includes(k))).toEqual([])
        const later = await run(host)({ cursor: pages.at(-1)!.cursor })
        expect({ n: later.events.length, gap: later.gap, more: later.more }).toEqual({ n: 0, gap: undefined, more: false })
      }
    }
  }, SLOW)

  test("R7 gap once per read across many small pages, both feeds cut at once", async () => {
    const data: Data = { issues: Array.from({ length: 40 }, (_, n) => issue(100 + n, T0 + n * MIN)), notifications: Array.from({ length: 30 }, (_, n) => note(300 + n, T0 + n * MIN + 1)) }
    const pages = await drain(run(linear(data, 2)), { since: SINCE, limit: 1 })
    expect(gaps(pages)).toHaveLength(1)
    expect(gaps(pages)[0]!.page).toBe(0)
    const listed = new Set(ids(pages))
    expect(owed(data, gaps(pages)[0]!.since).filter((k) => !listed.has(k))).toEqual([])
  }, SLOW)

  test("R8 seeded fuzz: random ties, page sizes, limits and arrivals; arrivals total below one call's reach: no duplicate, nothing after the latest gap since skipped (gap count reported)", async () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pick = (n: number) => Math.floor(rnd() * n)
    let worst = 0
    let multi = 0
    for (let round = 0; round < 400; round++) {
      const pageSize = 1 + pick(3)
      const limit = [1, 2, 3, 5, 100][pick(5)]!
      const issueCap = 8 * pageSize, noteCap = 5 * pageSize
      const data: Data = {
        issues: Array.from({ length: pick(issueCap * 2 + 3) }, (_, n) => issue(1000 + n, T0 + n * 7 * MIN + pick(3) * MIN)),
        notifications: Array.from({ length: pick(noteCap * 2 + 3) }, (_, n) => note(5000 + n, T0 + n * 7 * MIN + pick(3) * MIN + 1)),
      }
      let ai = 0, an = 0, clock = NOW
      // Every gap at a cursor must be a true overflow: one feed's unseen items exceeded its cap (8 or 5 pages).
      const base = run(linear(data, pageSize))
      const spurious: string[] = []
      const after = (t: number, k: string, p: [number, string]) => t > p[0] || (t === p[0] && k > p[1])
      const list = async (input: EventsListInput) => {
        let unseen = { i: 0, n: 0 }
        if (input.cursor) {
          const state = JSON.parse(Buffer.from(input.cursor, "base64url").toString()) as { i: [number, string]; n: [number, string] }
          unseen = {
            i: data.issues.filter((x) => after(Date.parse(x.updatedAt), issueKey(x), state.i)).length,
            n: data.notifications.filter((x) => after(Date.parse(x.createdAt), noteKey(x), state.n)).length,
          }
        }
        const page = await base(input)
        if (page.gap && input.cursor && unseen.i <= issueCap && unseen.n <= noteCap) spurious.push(JSON.stringify({ unseen, gap: page.gap }))
        return page
      }
      const pages = await drain(list, { since: SINCE, limit }, () => {
        clock += pick(2) ? MIN : DAY
        if (ai < issueCap - 2 && pick(3) === 0) data.issues.push(issue(20000 + ai++, clock))
        if (an < noteCap - 2 && pick(3) === 0) data.notifications.push(note(30000 + an++, clock + pick(2)))
      })
      const listed = ids(pages)
      const g = gaps(pages)
      worst = Math.max(worst, g.length)
      const ctx = { round, pageSize, limit, gaps: g, issues: data.issues.length, notes: data.notifications.length }
      expect({ ...ctx, dup: listed.length - new Set(listed).size }).toEqual({ ...ctx, dup: 0 })
      multi += g.length > 1 ? 1 : 0
      expect({ ...ctx, spurious }).toEqual({ ...ctx, spurious: [] })
      const missed = owed(data, g.length ? iso(Math.max(...g.map((x) => Date.parse(x.since)))) : SINCE).filter((k) => !listed.includes(k))
      expect({ ...ctx, missed }).toEqual({ ...ctx, missed: [] })
      for (const p of pages) expect(resultProblems(p, limit)).toEqual([])
    }
    // A second gap comes only from a true overflow (checked above), and at most once more in a read.
    expect(worst).toBeLessThanOrEqual(2)
  }, SLOW)


  test("R10 a tie the cursor is part way through, plus two arrivals, at Linear's real page sizes: no gap, every item listed once, in each feed", async () => {
    for (const [feed, pageSize, tie] of [["issues", 250, 1999], ["notifications", 100, 499]] as const) {
      const at = T0
      const data: Data =
        feed === "issues"
          ? { issues: Array.from({ length: tie }, (_, n) => issue(10000 + n, at)), notifications: [] }
          : { issues: [], notifications: Array.from({ length: tie }, (_, n) => note(10000 + n, at)) }
      const pages = await drain(run(linear(data, pageSize)), { since: SINCE, limit: 100 }, (n) => {
        if (n === 1) for (const k of [0, 1]) feed === "issues" ? data.issues.push(issue(99990 + k, NOW - MIN + k)) : data.notifications.push(note(99990 + k, NOW - MIN + k))
      })
      const listed = ids(pages)
      expect({ feed, gaps: gaps(pages) }).toEqual({ feed, gaps: [] })
      expect(new Set(listed).size).toBe(listed.length)
      expect(listed).toHaveLength(tie + 2)
    }
  }, SLOW)

  test("arrivals under one call's reach while a tie is drained, in both feeds at once, at Linear's real page sizes: no gap", async () => {
    const data: Data = { issues: Array.from({ length: 1990 }, (_, n) => issue(10000 + n, T0)), notifications: Array.from({ length: 490 }, (_, n) => note(10000 + n, T0)) }
    // After the first page, 20 of each arrive: with the listed tie items they pass the caps, but only unseen items count.
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 100 }, (n) => {
      if (n === 1) for (let k = 0; k < 20; k++) {
        data.issues.push(issue(90000 + k, NOW + k * MIN))
        data.notifications.push(note(90000 + k, NOW + k * MIN))
      }
    })
    const listed = ids(pages)
    expect(gaps(pages)).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed).toHaveLength(1990 + 490 + 40)
  }, SLOW)

  test("R11 the same tie with no arrival drains clean (control)", async () => {
    const data: Data = { issues: Array.from({ length: 1999 }, (_, n) => issue(10000 + n, T0)), notifications: [] }
    const pages = await drain(run(linear(data, 250)), { since: SINCE, limit: 100 })
    expect(gaps(pages)).toEqual([])
    expect(new Set(ids(pages)).size).toBe(1999)
  }, SLOW)


  test("just over the cap, when the page after it reaches the cursor: everything was read, so no gap", async () => {
    const data: Data = { issues: [], notifications: [note(1, T0)] }
    const host = linear(data, 100)
    const first = await run(host)({ since: SINCE })
    for (let k = 0; k < 530; k++) data.notifications.push(note(100 + k, T0 + DAY + k * 1000))
    const pages = await drain(run(host), { cursor: first.cursor, limit: 500 })
    expect(gaps(pages)).toEqual([])
    expect(new Set(ids(pages)).size).toBe(530)
  }, SLOW)

  test("R12 exactly one call's reach after a cursor, at Linear's real page sizes (500 notifications, 2,000 issues): no gap, all listed", async () => {
    for (const [feed, pageSize, cap] of [["notifications", 100, 500], ["issues", 250, 2000]] as const) {
      const data: Data = { issues: [], notifications: [] }
      if (feed === "issues") data.issues.push(issue(1, T0))
      else data.notifications.push(note(1, T0))
      const host = linear(data, pageSize)
      const first = await run(host)({ since: SINCE })
      for (let k = 0; k < cap; k++) feed === "issues" ? data.issues.push(issue(100 + k, T0 + DAY + k * 1000)) : data.notifications.push(note(100 + k, T0 + DAY + k * 1000))
      const pages = await drain(run(host), { cursor: first.cursor, limit: 500 })
      expect({ feed, gaps: gaps(pages) }).toEqual({ feed, gaps: [] })
      expect(new Set(ids(pages)).size).toBe(cap)
    }
  }, SLOW)

  test("more unseen items than one call's reach, and two arrivals: one gap, and everything after it listed", async () => {
    const data: Data = { issues: [issue(1, T0)], notifications: [] }
    const host = linear(data, 250)
    const first = await run(host)({ since: SINCE })
    // 8 pages of 250 are one call's allowance, and the ninth page, still full of unseen items, shows the overflow.
    for (let k = 0; k < 2300; k++) data.issues.push(issue(100 + k, T0 + DAY + k * 1000))
    const pages = await drain(run(host), { cursor: first.cursor, limit: 500 }, (n) => {
      if (n === 1) for (const k of [0, 1]) data.issues.push(issue(99990 + k, NOW + k * MIN))
    })
    const g = gaps(pages)
    expect(g.map((gap) => [gap.page, gap.reason])).toEqual([[0, "expired"]])
    const listed = new Set(ids(pages))
    expect(owed(data, g[0]!.since).filter((key) => !listed.has(key))).toEqual([])
  }, SLOW)
})
