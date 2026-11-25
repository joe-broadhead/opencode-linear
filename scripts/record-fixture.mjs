// Rewrites fixtures/conformance.json from the deterministic fake Linear MCP executor.
//
//   npm run fixtures
//
// The fake holds every invented workspace, issue and notification, so each recorded answer can be rebuilt byte for
// byte. A plugin with a real provider records from two real accounts with `npx plugin-kit record --account <alias>`
// instead. The fixture records only what the handlers answer today: `test/fixture.test.ts` replays every case.
import { mkdirSync, writeFileSync } from "node:fs"
import { announceStatus } from "../src/handlers/status.ts"
import { manifest, packageName } from "../src/manifest.ts"
import { callFor, recordingBus, run, runtimeFor } from "../test/support/handlers.ts"

const runtime = runtimeFor()
const since = "2026-11-01T00:00:00.000Z"

async function page(input, account = "work") {
  return run(runtime, "events_list", input, account)
}

/** The message a handler refuses a call with, for the fixture's `refuses`. */
async function refusal(input, account = "work", method = "events_list") {
  try {
    await run(runtime, method, input, account)
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error("expected a refusal")
}

const work = await page({ source: "linear", since })
const personal = await page({ source: "linear", since }, "personal")
const next = await page({ source: "linear", cursor: work.cursor })
const empty = await page({ source: "linear", since: "2026-11-25T00:00:00.000Z" })

const crossAccount = await refusal({ source: "linear", cursor: work.cursor }, "personal")
const unknownSource = await refusal({ source: "other" })

const probe = await run(runtime, "probe", { source: "linear" }, "work")
const issues = await run(runtime, "issues", { source: "linear" }, "work")
const status = await run(runtime, "status", {})

// The three bus events the plugin emits, each through the call site that emits it in the host.
const changedBus = recordingBus()
await run(runtime, "events_list", { source: "linear", since }, "work", callFor("work", { bus: changedBus }))
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

const fixture = {
  $comment: "Recorded from the deterministic fake Linear MCP executor through the plugin's own handlers: two mcp accounts, the activity source, the issues snapshot and the three bus events. Every workspace, person, issue and notification is invented.",
  plugin: packageName,
  namespace: manifest.plugin.summary,
  accounts: {
    real: true,
    aliases: ["work", "personal"],
    required: { method: "events_list", code: "ACCOUNT_REQUIRED" },
    unknown: { method: "events_list", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
    cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
  },
  sources: {
    "linear.activity": {
      cases: [
        { name: "the work account's changes", input: { source: "linear", account: "work", since }, expect: "page", answer: work },
        { name: "the personal account's changes", input: { source: "linear", account: "personal", since }, expect: "page", answer: personal },
        { name: "what follows the work page", input: { source: "linear", account: "work", cursor: work.cursor }, expect: "empty", answer: next },
        { name: "an empty window", input: { source: "linear", account: "work", since: "2026-11-25T00:00:00.000Z" }, expect: "empty", answer: empty },
        {
          name: "another account's cursor is refused",
          input: { source: "linear", account: "personal", cursor: work.cursor },
          expect: "CURSOR_INVALID",
          refuses: crossAccount,
        },
        { name: "an unknown source is refused", input: { source: "other", account: "work" }, expect: "SOURCE_UNKNOWN", refuses: unknownSource },
      ],
      probe: { input: { source: "linear", account: "work" }, answer: probe },
    },
    "linear.issues": {
      probe: { input: { source: "linear", account: "work" }, answer: probe },
      snapshot: { input: { source: "linear", account: "work" }, answer: issues },
    },
  },
  events: { emitted, status },
}

mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log(`recorded fixtures/conformance.json for ${packageName}; emitted ${emitted.join(", ")}`)
