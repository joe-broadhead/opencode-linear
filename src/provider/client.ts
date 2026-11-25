/**
 * The Linear provider: the only place this plugin names Linear's MCP endpoint.
 *
 * Linear's MCP server holds the credentials; OpenCode runs one server per account alias, and every read this plugin
 * makes goes through the host's own executor for that server's tool, with the caller's context. The plugin holds no
 * token and asserts no permission itself: `register` asserts the method's operations, and the host checks the MCP
 * tool's own rules when it runs it.
 *
 * The answers here are contract shapes, built with the contract's own modules. The mapping below is what Linear's
 * tools say; a change to Linear's answer is a mapping change, never a change to a contract type.
 */
import { createHash } from "node:crypto"
import { accountName } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"
import {
  eventsListResult,
  FIRST_RUN_HOURS,
  fitPage,
  makeEvent,
  probeResult,
  screenEvents,
  secretKinds,
  SourceError,
  type EventsListRequest,
  type EventsListResult,
  type FailedEvent,
  type ProbeResult,
  type SourceEvent,
} from "@we-the-rebel-alliance/plugin-contract/events"
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** Linear's MCP endpoint. One server per account alias points here; the server's name is what separates the OAuth. */
export const MCP_URL = "https://mcp.linear.app/mcp"

/** The source's name, as `events_list` takes it and as a cursor binds it. */
export const SOURCE = "linear"

/** The events source's capability id. */
export const ACTIVITY_SOURCE = "linear.activity"

/** The most bytes one events page may take: the source's declared `maxBytes`. */
export const PAGE_BYTES = 900_000

/** The most bytes one issues snapshot may take: the source's declared `maxBytes`. */
export const ISSUES_BYTES = 65_536

/** How far before a cursor this plugin reads again, so a write Linear shows late is still listed once. */
export const LOOKBACK_MS = 120_000

/** Issues per `list_issues` page, Linear's maximum, and the pages one call reads. */
const ISSUE_PAGE = 250
const ISSUE_PAGES = 4

/** Notifications per `get_notifications` page, and the pages one call reads. */
const NOTIFICATION_PAGE = 100
const NOTIFICATION_PAGES = 5

/** The most external ids a cursor keeps hashes for, each six base64url characters. */
const SEEN_MAX = 24

/** The issues `list_issues` answer needs, and nothing more. */
const ISSUE_FIELDS = [
  "id",
  "uuid",
  "title",
  "description",
  "url",
  "updatedAt",
  "status",
  "statusType",
  "priority",
  "labels",
  "assignee",
  "assigneeId",
  "createdBy",
  "createdById",
]

/** The fields the issues snapshot reads: the table's columns and the state that decides `done`. */
const LIST_FIELDS = ["id", "title", "status", "statusType", "priority", "url", "updatedAt"]

/** What a handler passes to the provider: the calling tool's context, as OpenCode gave it. */
export interface ToolCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  progress(update?: Readonly<Record<string, unknown>>): Promise<void>
}

/** One host tool the provider may run, such as `linear-work_list_issues`. */
export interface ToolEntry {
  readonly id: string
  execute(input: unknown, context: unknown): Promise<{
    readonly output?: unknown
    readonly content?: string | readonly { readonly type: string; readonly text?: string }[]
  }>
}

/** The host's tool list, as `ctx.tool` offers it. */
export interface ToolSource {
  list(): Promise<readonly ToolEntry[]>
}

/** One MCP read for one account: the tool's name without a server prefix, its input and the answer. */
export type ToolRead = (account: string, tool: string, input: Readonly<Record<string, unknown>>, call: ToolCall) => Promise<unknown>

const record = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {})
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim() : undefined)
const time = (value: unknown): number | undefined => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Linear answered in a shape this provider does not read: what happened, and the next step. */
const unreadable = (tool: string, method: string) =>
  new SourceError({
    code: "UNAVAILABLE",
    what: `${method} could not read Linear's ${tool} answer`,
    next: `Call Linear's ${tool} directly to see its answer, then read status.`,
  })

/**
 * The reads through the host's own MCP tools, one server per account: `linear` for `default` and `linear-<alias>`
 * for every other alias. A server with no tool is not signed in, which is `NEEDS_SIGN_IN`.
 */
export function createToolRead(options: { readonly plugin: string; readonly tools: ToolSource }): ToolRead {
  return async (account, tool, input, call) => {
    const server = accountName(options.plugin, account)
    const id = `${server}_${tool}`
    const entry = (await options.tools.list()).find((candidate) => candidate.id === id)
    if (entry === undefined) {
      throw new SourceError({
        code: "NEEDS_SIGN_IN",
        what: `OpenCode lists no ${tool} tool for the ${server} server, so the account is not signed in`,
        next: `Sign in to the ${server} MCP server in OpenCode, then try again.`,
      })
    }
    const result = await entry.execute(input, call)
    if (result.output !== undefined) return result.output
    const content = typeof result.content === "string" ? result.content : (result.content ?? []).flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : [])).join("\n")
    try {
      return JSON.parse(content) as unknown
    } catch {
      throw unreadable(tool, "the read")
    }
  }
}

/** One workspace's identity, as `get_workspace` answers it. */
interface Workspace {
  readonly id: string
  readonly display: string
}

/** Where a feed stood: the last listed item's time and its stable key. */
interface Position {
  readonly t: number
  readonly k: string
}

/** One change to list, with the position the cursor advances to and the feed it came from. */
interface Change {
  readonly feed: "issues" | "notifications"
  readonly pos: Position
  readonly event: SourceEvent
}

/** What one feed's bounded walk read, and where it was cut when Linear held more than the walk reads. */
interface FeedRead {
  readonly changes: readonly Change[]
  readonly cut?: number
}

/** What a cursor holds for each feed: its position and the hashes of what was listed in the lookback window. */
interface CursorState {
  readonly issues: Position
  readonly notifications: Position
  readonly issuesSeen: ReadonlySet<string>
  readonly notificationsSeen: ReadonlySet<string>
}

/** What the plugin asks its provider for. Handlers never touch a tool, a URL or a credential. */
export interface Provider {
  /** `probe`: the signed-in owner and workspace for one account, and no content. */
  probe(account: string, call: ToolCall): Promise<ProbeResult>
  /** `events_list`: what changed for one account since the request's cursor or window. */
  page(input: { readonly account: string; readonly request: EventsListRequest; readonly now: number; readonly call: ToolCall }): Promise<EventsListResult>
  /** `issues`: one account's assigned issues as the contract's `list` output. */
  issues(input: { readonly account: string; readonly now: number; readonly call: ToolCall }): Promise<IssuesSnapshot>
}

/** The `issues` snapshot's answer: the contract's snapshot envelope around a `list`. */
export interface IssuesSnapshot {
  readonly account: string
  readonly data: { readonly items: readonly IssueItem[]; readonly editable: false }
  readonly asOf: string
  readonly trust: "untrusted"
}

/** One row of the `list` output. */
interface IssueItem {
  readonly id: string
  readonly text: string
  readonly note?: string
  readonly done?: true
}

const after = (a: Position, b: Position): boolean => a.t > b.t || (a.t === b.t && a.k > b.k)
const byPosition = (a: Position, b: Position): number => a.t - b.t || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)
const positionOf = (value: unknown): Position | undefined =>
  Array.isArray(value) && value.length === 2 && Number.isSafeInteger(value[0]) && typeof value[1] === "string" ? { t: value[0] as number, k: value[1] } : undefined

/** A listed item's hash in the cursor: 36 bits of the sha256 of its external id, six base64url characters. */
const seenHash = (externalId: string): string => createHash("sha256").update(externalId).digest("base64url").slice(0, 6)

const hashesOf = (value: unknown): ReadonlySet<string> => new Set(typeof value === "string" ? (value.match(/.{6}/g) ?? []) : [])

/** The binding every cursor of the activity source carries. */
const bindingOf = (plugin: string, account: string) => ({ plugin, source: SOURCE, account })

/** A cursor's state, or `CURSOR_INVALID` when it is not one this source issued for the account. */
function stateOf(plugin: string, cursor: string, account: string): CursorState {
  const decoded = decodeBoundCursor(bindingOf(plugin, account), cursor)
  const issues = decoded.ok ? positionOf(decoded.state["i"]) : undefined
  const notifications = decoded.ok ? positionOf(decoded.state["n"]) : undefined
  if (!decoded.ok || issues === undefined || notifications === undefined) {
    throw new SourceError({
      code: "CURSOR_INVALID",
      what: decoded.ok ? "the cursor holds no position this source issued" : decoded.reason === "foreign" ? "the cursor belongs to another plugin, source or account" : "the cursor is not one this plugin issued",
      next: "Read again without the cursor, with since, to start a fresh window.",
    })
  }
  return { issues, notifications, issuesSeen: hashesOf(decoded.state["si"]), notificationsSeen: hashesOf(decoded.state["sn"]) }
}

/** A person Linear names: an object with an id and a name, with its id in a sibling `<field>Id` when absent. */
function person(value: unknown, id?: unknown): { id?: string; name?: string } {
  const data = record(value)
  const found = { id: text(data["id"]) ?? text(id), name: text(value) ?? text(data["displayName"]) ?? text(data["name"]) }
  return { ...(found.id === undefined ? {} : { id: found.id }), ...(found.name === undefined ? {} : { name: found.name }) }
}

const actorsFor = (role: string, who: { id?: string; name?: string }) =>
  who.id === undefined ? [] : [{ role, id: `linear:${who.id}`, ...(who.name === undefined ? {} : { name: who.name }) }]

/** Label names: strings, or objects with a name. */
const names = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap((item) => text(item) ?? text(record(item)["name"]) ?? []) : [])

/** One issue as a contract event, at its update time, or undefined for an entry without an identifier or a time. */
function issueChange(account: string, item: unknown): Change | undefined {
  const data = record(item)
  const identifier = text(data["id"])
  const updated = time(data["updatedAt"])
  if (identifier === undefined || updated === undefined) return undefined
  const state = text(data["status"]) ?? text(record(data["status"])["name"])
  const priority = text(record(data["priority"])["name"]) ?? text(data["priority"])
  const facts = [state === undefined ? undefined : `State: ${state}`, priority === undefined ? undefined : `Priority: ${priority}`].filter((fact): fact is string => fact !== undefined).join(". ")
  const title = text(data["title"]) ?? ""
  const external = `${identifier}@${new Date(updated).toISOString()}`
  const event = makeEvent({
    source: SOURCE,
    account,
    external_id: external,
    kind: "issue",
    occurred_at: updated,
    thread: `linear-issue:${text(data["uuid"]) ?? identifier}`,
    actors: [...actorsFor("assignee", person(data["assignee"], data["assigneeId"])), ...actorsFor("creator", person(data["createdBy"], data["createdById"]))],
    title: title === "" ? identifier : `${identifier}: ${title}`,
    text: [facts === "" ? undefined : `${facts}.`, text(data["description"])].filter((part): part is string => part !== undefined).join("\n\n"),
    url: text(data["url"]) ?? null,
    labels: ["assigned", ...names([data["statusType"]]), ...names(data["labels"])],
  })
  return { feed: "issues", pos: { t: updated, k: external }, event }
}

/** One notification as a contract event, at its creation time, or undefined for an entry without an id or a time. */
function notificationChange(account: string, item: unknown): Change | undefined {
  const data = record(item)
  const id = text(data["id"])
  const created = time(data["createdAt"])
  if (id === undefined || created === undefined) return undefined
  const issue = record(data["issue"])
  const identifier = text(issue["identifier"]) ?? text(data["issueIdentifier"])
  const type = text(data["type"])
  const what = type?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase()
  const external = `notification:${id}`
  const issueTitle = text(issue["title"])
  const title = identifier !== undefined ? (issueTitle === undefined ? identifier : `${identifier}: ${issueTitle}`) : (text(data["title"]) ?? what ?? "Linear notification")
  const event = makeEvent({
    source: SOURCE,
    account,
    external_id: external,
    kind: "issue",
    occurred_at: created,
    thread: identifier === undefined ? null : `linear-issue:${text(issue["uuid"]) ?? text(issue["id"]) ?? identifier}`,
    actors: actorsFor("from", person(data["actor"], data["actorId"])),
    title,
    text: [what === undefined ? undefined : `Notification: ${what}.`, text(data["subtitle"]), text(data["body"]) ?? text(record(data["comment"])["body"])].filter((part): part is string => part !== undefined).join("\n\n"),
    url: text(issue["url"]) ?? text(data["url"]) ?? null,
    labels: ["notification", ...names([type]), ...(identifier === undefined ? ["event"] : [])],
  })
  return { feed: "notifications", pos: { t: created, k: external }, event }
}

/** The items a Linear list answer holds, or `UNAVAILABLE` when the answer is not one. */
function itemsOf(answer: unknown, key: string, tool: string): { items: readonly unknown[]; next?: string } {
  const data = record(answer)
  const items = Array.isArray(answer) ? answer : data[key]
  if (!Array.isArray(items)) throw unreadable(tool, "the read")
  const more = data["hasNextPage"] === true
  const next = text(data["cursor"]) ?? text(data["endCursor"])
  if (more && next === undefined) throw unreadable(tool, "the read")
  return { items, ...(more && next !== undefined ? { next } : {}) }
}

/** Reads a feed newest first for at most `pages` pages, and cuts at the oldest time it read when Linear holds more. */
async function walk(
  tool: string,
  pages: number,
  since: number,
  page: (cursor: string | undefined) => Promise<{ items: readonly unknown[]; next?: string }>,
  change: (item: unknown) => Change | undefined,
): Promise<FeedRead> {
  const changes: Change[] = []
  let cursor: string | undefined
  let oldest = Number.POSITIVE_INFINITY
  for (let index = 0; index < pages; index++) {
    const answer = await page(cursor)
    for (const item of answer.items) {
      const found = change(item)
      if (found === undefined) throw unreadable(tool, "the read")
      changes.push(found)
      oldest = Math.min(oldest, found.pos.t)
    }
    if (answer.next === undefined || oldest < since) return { changes }
    if (index === pages - 1) return { changes, cut: oldest }
    cursor = answer.next
  }
  return { changes }
}

/** Every change to an issue assigned to the person after `since`, archived issues included. */
function readIssues(read: ToolRead, account: string, since: number, call: ToolCall): Promise<FeedRead> {
  return walk(
    "list_issues",
    ISSUE_PAGES,
    since,
    async (cursor) =>
      itemsOf(
        await read(
          account,
          "list_issues",
          {
            assignee: "me",
            orderBy: "updatedAt",
            updatedAt: new Date(Math.max(0, since)).toISOString(),
            includeArchived: true,
            limit: ISSUE_PAGE,
            fields: ISSUE_FIELDS,
            ...(cursor === undefined ? {} : { cursor }),
          },
          call,
        ),
        "issues",
        "list_issues",
      ),
    (item) => issueChange(account, item),
  )
}

/** Every notification after `since`, oldest first; Linear lists them newest first. */
function readNotifications(read: ToolRead, account: string, since: number, call: ToolCall): Promise<FeedRead> {
  return walk(
    "get_notifications",
    NOTIFICATION_PAGES,
    since,
    async (cursor) => itemsOf(await read(account, "get_notifications", { limit: NOTIFICATION_PAGE, ...(cursor === undefined ? {} : { cursor }) }, call), "notifications", "get_notifications"),
    (item) => notificationChange(account, item),
  )
}

/** The changes this call may list: after the cursor, or late arrivals in the lookback the cursor has not seen, minus a cut. */
function fresh(changes: readonly Change[], from: Position, line: number, seen: ReadonlySet<string>, cut: number | undefined): Change[] {
  return changes.filter((change) => {
    if (cut !== undefined && change.pos.t <= cut) return false
    if (after(change.pos, from)) return true
    if (change.pos.t < line) return false
    return !seen.has(seenHash(change.event.external_id))
  })
}

/** The hashes a cursor keeps for a feed: what it accounted for in the lookback, newest first, at most `SEEN_MAX`. */
function seenFor(changes: readonly Change[], at: Position): string {
  return changes
    .filter((change) => change.pos.t >= at.t - LOOKBACK_MS && !after(change.pos, at))
    .sort((left, right) => byPosition(right.pos, left.pos))
    .slice(0, SEEN_MAX)
    .map((change) => seenHash(change.event.external_id))
    .join("")
}

/** The workspaces and users answer as `{ workspace: … }` / `{ user: … }`, or directly. */
function unwrap(answer: unknown, keys: readonly string[]): Record<string, unknown> {
  const data = record(answer)
  for (const key of keys) if (typeof data[key] === "object" && data[key] !== null) return record(data[key])
  return data
}

const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/

/** Who is signed in, from `get_workspace` and `get_user` "me": the owner and the workspace it belongs to. */
async function identity(read: ToolRead, account: string, call: ToolCall): Promise<{ owner: Owner; workspace: Workspace }> {
  const workspaceData = unwrap(await read(account, "get_workspace", {}, call), ["workspace", "organization"])
  const id = text(workspaceData["id"])
  if (id === undefined) throw unreadable("get_workspace", "probe")
  const fromUrl = /^https:\/\/linear\.app\/([A-Za-z0-9_-]+)\/?$/.exec(text(workspaceData["url"]) ?? "")?.[1]
  const display = text(workspaceData["urlKey"]) ?? fromUrl ?? text(workspaceData["name"]) ?? id
  const user = unwrap(await read(account, "get_user", { query: "me" }, call), ["user", "viewer"])
  const email = text(user["email"])?.toLowerCase()
  const userId = text(user["id"])
  if (email === undefined || !EMAIL.test(email) || userId === undefined) throw unreadable("get_user", "probe")
  const label = (text(user["name"]) ?? text(user["displayName"]) ?? email).replace(/\s+/g, " ")
  return { owner: { id: `mailto:${email}`, label: `${label} (${display})`.slice(0, 200) }, workspace: { id, display } }
}

/** The `list` output's row for one issue, or undefined when the entry says nothing a table can show. */
function listItem(item: unknown): IssueItem | undefined {
  const data = record(item)
  const identifier = text(data["id"])
  const title = text(data["title"])
  if (identifier === undefined || title === undefined) return undefined
  const id = identifier.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 128)
  const body = title.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
  if (id === "" || body === "" || secretKinds(id).length > 0 || secretKinds(body).length > 0) return undefined
  const state = text(data["status"]) ?? text(record(data["status"])["name"])
  const note = state === undefined ? undefined : state.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
  if (note !== undefined && secretKinds(note).length > 0) return undefined
  const type = text(data["statusType"])
  const done = type === "completed" || type === "canceled" || /^(done|canceled|cancelled|completed)$/i.test(note ?? "")
  return { id, text: body, ...(note === undefined || note === "" ? {} : { note }), ...(done ? { done: true as const } : {}) }
}

/** The provider for one installed plugin: the contract's answers around Linear's MCP tools. */
export function createProvider(options: { readonly plugin: string; readonly package: string; readonly read: ToolRead }): Provider {
  return {
    async probe(account, call) {
      const who = await identity(options.read, account, call)
      return probeResult({ source: SOURCE, account, owner: who.owner })
    },

    async page({ account, request, now, call }) {
      const from = request.cursor === undefined ? undefined : stateOf(options.plugin, request.cursor, account)
      const since = request.since ?? now - FIRST_RUN_HOURS * 3_600_000
      const fromIssues = from?.issues ?? { t: since, k: "" }
      const fromNotifications = from?.notifications ?? { t: since, k: "" }
      const lineIssues = fromIssues.t - LOOKBACK_MS
      const lineNotifications = fromNotifications.t - LOOKBACK_MS
      // One feed failing does not cancel the other: the page lists what it could read, names the feed it could not,
      // and keeps that feed's position in the cursor, so the next read asks for it again.
      const failed: FailedEvent[] = []
      const settle = (feed: "issues" | "notifications", result: PromiseSettledResult<FeedRead>): FeedRead => {
        if (result.status === "fulfilled") return result.value
        if (!(result.reason instanceof SourceError)) throw result.reason
        failed.push({ external_id: `feed:${feed}`, code: result.reason.code })
        return { changes: [] }
      }
      const [who, issuesSettled, notificationsSettled] = await Promise.all([
        identity(options.read, account, call),
        readIssues(options.read, account, lineIssues, call).then(
          (value): PromiseSettledResult<FeedRead> => ({ status: "fulfilled", value }),
          (reason: unknown): PromiseSettledResult<FeedRead> => ({ status: "rejected", reason }),
        ),
        readNotifications(options.read, account, lineNotifications, call).then(
          (value): PromiseSettledResult<FeedRead> => ({ status: "fulfilled", value }),
          (reason: unknown): PromiseSettledResult<FeedRead> => ({ status: "rejected", reason }),
        ),
      ])
      if (issuesSettled.status === "rejected" && notificationsSettled.status === "rejected") throw issuesSettled.reason
      const issuesRead = settle("issues", issuesSettled)
      const notificationsRead = settle("notifications", notificationsSettled)
      const cut = [issuesRead.cut, notificationsRead.cut].filter((value): value is number => value !== undefined)
      const edge = cut.length === 0 ? undefined : Math.min(...cut)
      const changes = [
        ...fresh(issuesRead.changes, fromIssues, lineIssues, from?.issuesSeen ?? new Set(), edge),
        ...fresh(notificationsRead.changes, fromNotifications, lineNotifications, from?.notificationsSeen ?? new Set(), edge),
      ]
      const unique = new Map<string, Change>()
      for (const change of changes) if (!unique.has(change.event.external_id)) unique.set(change.event.external_id, change)
      const merged = [...unique.values()].sort((left, right) => byPosition(left.pos, right.pos))
      const screened = screenEvents(merged.map((change) => change.event))
      const refusedIds = new Set(screened.refused.map((entry) => entry.external_id))
      const fits = fitPage(screened.events, request.limit, PAGE_BYTES)
      const kept: Change[] = []
      const consumed: Change[] = []
      let keptCount = 0
      let more = false
      for (const change of merged) {
        if (refusedIds.has(change.event.external_id)) {
          consumed.push(change)
          continue
        }
        if (keptCount >= fits) {
          more = true
          break
        }
        kept.push(change)
        consumed.push(change)
        keptCount++
      }
      const lastOf = (feed: Change["feed"], fallback: Position): Position => {
        const held = consumed.filter((change) => change.feed === feed)
        return held.reduce((ahead, change) => (after(change.pos, ahead) ? change.pos : ahead), fallback)
      }
      const issuesAt = lastOf("issues", fromIssues)
      const notificationsAt = lastOf("notifications", fromNotifications)
      // The hashes cover everything read up to each feed's new position: listed now, refused, or already accounted.
      const accounted = (changes: readonly Change[], at: Position) => changes.filter((change) => !after(change.pos, at))
      const cursor = encodeBoundCursor(bindingOf(options.plugin, account), {
        i: [issuesAt.t, issuesAt.k],
        n: [notificationsAt.t, notificationsAt.k],
        si: seenFor(accounted(issuesRead.changes, issuesAt), issuesAt),
        sn: seenFor(accounted(notificationsRead.changes, notificationsAt), notificationsAt),
      })
      const refused = screened.refused.filter((entry) => consumed.some((change) => change.event.external_id === entry.external_id))
      return eventsListResult(
        { source: SOURCE, account, owner: who.owner },
        kept.map((change) => change.event),
        cursor,
        more,
        {
          ...(refused.length === 0 ? {} : { refused }),
          ...(failed.length === 0 ? {} : { failed }),
          ...(edge === undefined ? {} : { gap: { reason: request.cursor === undefined ? "window-truncated" : "expired", since: new Date(edge + 1).toISOString() } }),
          plugin: options.package,
          asOf: new Date(now).toISOString(),
        },
      )
    },

    async issues({ account, now, call }) {
      const answer = itemsOf(
        await options.read(account, "list_issues", { assignee: "me", orderBy: "updatedAt", includeArchived: true, limit: 50, fields: LIST_FIELDS }, call),
        "issues",
        "list_issues",
      )
      const items: IssueItem[] = []
      const seen = new Set<string>()
      let bytes = 0
      for (const entry of answer.items) {
        const item = listItem(entry)
        if (item === undefined || seen.has(item.id)) continue
        const size = Buffer.byteLength(JSON.stringify(item)) + 1
        if (bytes + size > ISSUES_BYTES) break
        bytes += size
        seen.add(item.id)
        items.push(item)
      }
      return { account, data: { items, editable: false }, asOf: new Date(now).toISOString(), trust: "untrusted" }
    },
  }
}

/** The MCP server URL for one account's server. Linear's endpoint is one URL; the server's name carries the account. */
export function mcpServerUrl(_name: string): string {
  return MCP_URL
}
