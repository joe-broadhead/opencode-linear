// The source contract's conformance kit over the source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against recorded Linear answers (test/fixtures/sources.json, all
// invented): no Linear call, no sign-in. The reads go through a fake of OpenCode's executor that asserts
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
import type { Status } from "../../src/status.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
/** The declaration as Memory's schema parses it, which is what the kit takes (source-contract#30, item 8). */
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
/** Each Linear read answers one page in one call, so no single event can fail on its own. */
const ATOMIC = "Linear answers each list_issues and get_notifications read as one page in one call, so no single event can fail on its own"

const answer = (value: unknown) => ({ output: value, content: [{ type: "text", text: JSON.stringify(value) }] })

/**
 * OpenCode's executors for Linear's reads, answering as Linear does from the recorded data: assigned issues newest
 * first after `updatedAt`, notifications newest first, one page each. Each asserts its own `linear_<tool>` on the
 * session's permission first, as the host does.
 */
function executors(permission: SessionContext["permission"]) {
  const execute = (tool: string, input: Record<string, unknown>) => {
    if (tool === "linear_get_user") return answer(input["query"] === "me" ? LINEAR["me"] : {})
    if (tool === "linear_get_workspace") return answer(LINEAR["workspace"])
    if (tool === "linear_list_issues") {
      const after = Date.parse(String(input["updatedAt"]))
      const issues = (LINEAR["issues"] as { updatedAt: string }[]).filter((item) => Date.parse(item.updatedAt) > after).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      return answer({ issues, hasNextPage: false })
    }
    return answer({ notifications: LINEAR["notifications"], hasNextPage: false })
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
  ]
}

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  test("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => item.id)).toEqual(["linear.activity"])
  })

  test("linear.activity keeps the contract", async () => {
    const report = await sourceConformance({
      plugin: PACKAGE,
      source,
      tools,
      calls: {
        list: (input, context) => list(input, context),
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
    // Linear's cursor holds an update time in each feed, and Linear keeps the issues and the inbox it lists, so a
    // cursor never loses history: the plugin never answers CURSOR_EXPIRED, and the kit's gap check cannot run
    // (source-contract#30, item 5). The report stays incomplete on that one check.
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual(["gap-and-cursor-expired"])
  })

  test("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source)).toEqual(["linear.activity"])
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: "@we-the-rebel-alliance/source-contract@0.1.0",
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
