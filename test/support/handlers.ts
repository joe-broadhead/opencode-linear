/**
 * The handlers, driven through their real entry, with a deterministic fake Linear MCP executor and a fixed clock.
 *
 * The fake is the MCP server, not the provider: `createProvider` is the real mapping, so every recorded answer is
 * produced by the same code the plugin runs. Every person, workspace and issue is invented.
 */
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Bus } from "@we-the-rebel-alliance/plugin-contract/bus"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest, packageName, version } from "../../src/manifest.ts"
import { handlersFor, type HandlerRuntime, type PluginServer } from "../../src/handlers/index.ts"
import { createProvider, type ToolCall, type ToolRead } from "../../src/provider/client.ts"

/** The fixed time every recorded answer is stamped with. */
export const NOW = Date.parse("2026-11-25T09:00:00.000Z")

/** The options the fixture and the T1 host use: two aliases. */
export const OPTIONS = { accounts: { work: {}, personal: {} } } as const

/** One invented workspace, its signed-in user, its issues and its notifications. */
interface FakeAccount {
  readonly workspace: Record<string, unknown>
  readonly user: Record<string, unknown>
  readonly issues: readonly Record<string, unknown>[]
  readonly notifications: readonly Record<string, unknown>[]
}

/** An invented credential for the screening test, built from parts so no committed line is itself a credential. */
const FAKE_KEY = ["sk", "live", "abcdefghijklmnopqrstuvwx"].join("_")

const WORK: FakeAccount = {
  workspace: { id: "ws-acme", urlKey: "acme", name: "Acme" },
  user: { id: "U-ACME-ADA", name: "Ada Lane", email: "ada@example.test" },
  issues: [
    {
      id: "ENG-101",
      uuid: "issue-101",
      title: "Queue migration",
      description: "The queue migration is on for Thursday.",
      url: "https://linear.app/acme/issue/ENG-101/queue-migration",
      updatedAt: "2026-11-24T10:00:00.000Z",
      status: "In Progress",
      statusType: "started",
      priority: { name: "High" },
      labels: [{ name: "infra" }],
      assignee: { id: "U-ACME-ADA", name: "Ada Lane" },
      assigneeId: "U-ACME-ADA",
      createdBy: { id: "U-ACME-KAI", name: "Kai Mensah" },
      createdById: "U-ACME-KAI",
    },
    {
      id: "ENG-102",
      uuid: "issue-102",
      title: "Rehearsal notes",
      description: "Rehearsal passed; watch the lag after the switch.",
      url: "https://linear.app/acme/issue/ENG-102/rehearsal-notes",
      updatedAt: "2026-11-23T09:30:00.000Z",
      status: "Done",
      statusType: "completed",
      priority: { name: "Low" },
      labels: [{ name: "release" }],
      assignee: { id: "U-ACME-ADA", name: "Ada Lane" },
      assigneeId: "U-ACME-ADA",
      createdBy: { id: "U-ACME-KAI", name: "Kai Mensah" },
      createdById: "U-ACME-KAI",
    },
    {
      id: "ENG-103",
      uuid: "issue-103",
      title: "Handover",
      description: "No open incidents.",
      url: "https://linear.app/acme/issue/ENG-103/handover",
      updatedAt: "2026-11-22T08:00:00.000Z",
      status: "Backlog",
      statusType: "backlog",
      priority: { name: "Medium" },
      labels: [],
      assignee: { id: "U-ACME-ADA", name: "Ada Lane" },
      assigneeId: "U-ACME-ADA",
      createdBy: { id: "U-ACME-ADA", name: "Ada Lane" },
      createdById: "U-ACME-ADA",
    },
    {
      id: "ENG-104",
      uuid: "issue-104",
      title: "A pasted key",
      description: `The debug output held ${FAKE_KEY} and should never be listed.`,
      url: "https://linear.app/acme/issue/ENG-104/a-pasted-key",
      updatedAt: "2026-11-21T07:00:00.000Z",
      status: "Todo",
      statusType: "unstarted",
      priority: { name: "Urgent" },
      labels: [],
      assignee: { id: "U-ACME-ADA", name: "Ada Lane" },
      assigneeId: "U-ACME-ADA",
      createdBy: { id: "U-ACME-ADA", name: "Ada Lane" },
      createdById: "U-ACME-ADA",
    },
  ],
  notifications: [
    {
      id: "n-work-1",
      type: "issueMention",
      createdAt: "2026-11-24T11:00:00.000Z",
      issue: { id: "uuid-101", identifier: "ENG-101", title: "Queue migration", uuid: "issue-101", url: "https://linear.app/acme/issue/ENG-101/queue-migration" },
      actor: { id: "U-ACME-KAI", name: "Kai Mensah" },
      subtitle: "Kai mentioned you",
    },
    {
      id: "n-work-2",
      type: "issueAssigned",
      createdAt: "2026-11-23T12:00:00.000Z",
      issue: { id: "uuid-103", identifier: "ENG-103", title: "Handover", uuid: "issue-103", url: "https://linear.app/acme/issue/ENG-103/handover" },
      actor: { id: "U-ACME-KAI", name: "Kai Mensah" },
      subtitle: "Kai assigned you",
    },
  ],
}

const PERSONAL: FakeAccount = {
  workspace: { id: "ws-studio", urlKey: "studio", name: "Studio" },
  user: { id: "U-HOME-ADA", name: "Ada Lane", email: "ada@personal.example" },
  issues: [
    {
      id: "STUDIO-1",
      uuid: "issue-studio-1",
      title: "Weekend plans",
      description: "Are we still walking on Saturday?",
      url: "https://linear.app/studio/issue/STUDIO-1/weekend-plans",
      updatedAt: "2026-11-23T18:00:00.000Z",
      status: "Todo",
      statusType: "unstarted",
      priority: { name: "No priority" },
      labels: [],
      assignee: { id: "U-HOME-ADA", name: "Ada Lane" },
      assigneeId: "U-HOME-ADA",
      createdBy: { id: "U-HOME-ADA", name: "Ada Lane" },
      createdById: "U-HOME-ADA",
    },
  ],
  notifications: [
    {
      id: "n-studio-1",
      type: "issueComment",
      createdAt: "2026-11-23T19:00:00.000Z",
      issue: { id: "uuid-studio-1", identifier: "STUDIO-1", title: "Weekend plans", uuid: "issue-studio-1", url: "https://linear.app/studio/issue/STUDIO-1/weekend-plans" },
      actor: { id: "U-HOME-ROWAN", name: "Rowan Vale" },
      subtitle: "Rowan commented",
    },
  ],
}

const ACCOUNTS: Readonly<Record<string, FakeAccount>> = { work: WORK, personal: PERSONAL }

/** One page of a newest-first list, by offset cursor, as Linear answers it. */
function pageSlice(items: readonly Record<string, unknown>[], input: Readonly<Record<string, unknown>>, max: number): { readonly items: readonly Record<string, unknown>[]; readonly hasNextPage: boolean; readonly cursor?: string } {
  const limit = Math.min(typeof input["limit"] === "number" ? input["limit"] : 50, max)
  const start = typeof input["cursor"] === "string" ? Number(input["cursor"]) : 0
  const itemsOnPage = items.slice(start, start + limit)
  const next = start + itemsOnPage.length
  return { items: itemsOnPage, hasNextPage: next < items.length, ...(next < items.length ? { cursor: String(next) } : {}) }
}

/**
 * The fake Linear MCP executor: it answers the tools the provider reads, in the shapes Linear's server answers, and
 * refuses an alias it does not hold the way a server would.
 */
export const fakeRead: ToolRead = async (account, tool, input) => {
  const held = ACCOUNTS[account]
  if (held === undefined) throw new SourceError({ code: "ACCOUNT_UNKNOWN", what: `${account} is not an account of linear`, next: "Use one of the aliases in the plugin's accounts option." })
  if (tool === "get_workspace") return held.workspace
  if (tool === "get_user") return held.user
  if (tool === "list_issues") {
    const updatedAt = typeof input["updatedAt"] === "string" ? Date.parse(input["updatedAt"]) : 0
    const issues = [...held.issues].filter((issue) => Date.parse(String(issue["updatedAt"])) > updatedAt).sort((left, right) => Date.parse(String(right["updatedAt"])) - Date.parse(String(left["updatedAt"])))
    const page = pageSlice(issues, input, 250)
    return { issues: page.items, hasNextPage: page.hasNextPage, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
  }
  if (tool === "get_notifications") {
    const notifications = [...held.notifications].sort((left, right) => Date.parse(String(right["createdAt"])) - Date.parse(String(left["createdAt"])))
    const page = pageSlice(notifications, input, 100)
    return { notifications: page.items, hasNextPage: page.hasNextPage, ...(page.cursor === undefined ? {} : { cursor: page.cursor }) }
  }
  throw new SourceError({ code: "UNAVAILABLE", what: `the fake has no ${tool} tool`, next: "Use one of the tools the provider reads." })
}

/** A runtime with the real manifest, the real provider and a fake MCP executor. */
export function runtimeFor(options: Readonly<Record<string, unknown>> = OPTIONS, overrides: Partial<HandlerRuntime> = {}): HandlerRuntime {
  const plan = accountsOf(manifest, options)
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  const servers: readonly PluginServer[] = plan.value.accounts.map((account) => ({ name: accountName(manifest.plugin.name, account.alias), status: { status: "connected" } }))
  return {
    manifest,
    plugin: manifest.plugin.name,
    packageName,
    version,
    hostVersion: "2.4.1",
    tested: manifest.plugin.host.tested,
    accounts: plan.value.accounts,
    accountName: (alias) => accountName(manifest.plugin.name, alias),
    provider: createProvider({ plugin: manifest.plugin.name, package: packageName, read: fakeRead }),
    clock: () => NOW,
    servers: async () => servers,
    problems: () => [],
    ...overrides,
  }
}

/** What one call emitted on the bus. */
export interface Emitted {
  readonly event: string
  readonly data: Readonly<Record<string, unknown>>
}

/** A bus that records what a handler emits and accepts every event. */
export function recordingBus(): Bus & { readonly emitted: Emitted[] } {
  const emitted: Emitted[] = []
  return {
    name: manifest.plugin.name,
    emitted,
    async emit(event, data) {
      emitted.push({ event, data: data as Readonly<Record<string, unknown>> })
      return { ok: true }
    },
  }
}

/** The call context a handler sees, as `register` builds it. */
export function callFor(account: string, options: { readonly bus?: Bus; readonly unguarded?: readonly string[] } = {}): MethodCall {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => undefined,
    account,
    bus: options.bus ?? recordingBus(),
    unguardedAgents: async () => ({ ok: true, agents: options.unguarded ?? [] }),
    door: "tool",
  }
}

/** Run one handler with an account and the input `register` would pass. */
export async function run(runtime: HandlerRuntime, method: "status" | "probe" | "events_list" | "issues", input: Readonly<Record<string, unknown>>, account = "work", call = callFor(account)): Promise<unknown> {
  const handler = handlersFor(runtime)[method]
  if (handler === undefined) throw new Error(`the handler table has no ${method}`)
  return handler.run(input, call)
}

/** The `ToolCall` a provider receives, from a handler's call. */
export const toolCall = (account: string): ToolCall => callFor(account)
