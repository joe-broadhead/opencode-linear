/**
 * `createToolRead` against a `ToolSource`: the branches the real host cannot produce.
 *
 * The host test (`test/host/tool-read.test.ts`) runs the read through the real 2.4.1 executor and proves the answer,
 * `NEEDS_SIGN_IN` and an upstream error. A 2.4.1 executor always gives a call an `output` (a string, an object or
 * null), so the content-only parsing branch is exercised here, where the source can answer with content alone.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { createToolRead, type ToolCall, type ToolEntry } from "../src/provider/client.ts"

const call: ToolCall = {
  sessionID: "ses_test",
  agent: "build",
  messageID: "msg_test",
  id: "call_test",
  signal: new AbortController().signal,
  progress: async () => undefined,
}

const source = (entries: readonly ToolEntry[]) => ({ list: async () => entries })
const entry = (id: string, result: Awaited<ReturnType<ToolEntry["execute"]>>): ToolEntry => ({ id, execute: async () => result })
const contractError = (code: string) => (error: unknown) => error instanceof SourceError && error.code === code

test("an output is returned unchanged, without parsing the content", async () => {
  const read = createToolRead({ plugin: "linear", tools: source([entry("linear-work_get_workspace", { output: { name: "Acme" }, content: [{ type: "text", text: "not json" }] })]) })
  assert.deepEqual(await read("work", "get_workspace", {}, call), { name: "Acme" })
})

test("a content-only answer is parsed as JSON", async () => {
  const read = createToolRead({ plugin: "linear", tools: source([entry("linear-work_list_issues", { content: [{ type: "text", text: '{"issues":[]}' }] })]) })
  assert.deepEqual(await read("work", "list_issues", {}, call), { issues: [] })
})

test("a content-only answer that is not JSON is UNAVAILABLE", async () => {
  const read = createToolRead({ plugin: "linear", tools: source([entry("linear-work_list_issues", { content: [{ type: "text", text: "not json" }] })]) })
  await assert.rejects(() => read("work", "list_issues", {}, call), contractError("UNAVAILABLE"))
})

test("a server with no tool for the alias is NEEDS_SIGN_IN", async () => {
  const read = createToolRead({ plugin: "linear", tools: source([]) })
  await assert.rejects(() => read("work", "list_issues", {}, call), contractError("NEEDS_SIGN_IN"))
})
