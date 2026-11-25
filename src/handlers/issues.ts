/**
 * `issues`: the assigned-issues snapshot, as the contract's `list` output in a snapshot envelope. A collector reads it
 * through the source `linear.issues`; an agent may read it as a quick table. It is a sample, never a count.
 */
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { SOURCE } from "../provider/client.ts"
import { refuseSource } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** The snapshot envelope around the contract's `list` output. */
const SNAPSHOT = {
  type: "object",
  properties: {
    account: { type: "string" },
    data: { type: "object", additionalProperties: true },
    asOf: { type: "string" },
    trust: { type: "string", const: "untrusted" },
  },
  required: ["account", "data", "asOf", "trust"],
  additionalProperties: false,
} as const

/** `issues`: up to fifty assigned issues as a list, most recently updated first, in every state. */
export function issuesHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "The Linear issues assigned to one account, most recently updated first, in every state: up to fifty rows of identifier, title and state. " +
      "A sample, not a count; use Linear's list_issues for totals and filters. It answers the `list` snapshot a collector binds to.",
    input: {
      type: "object",
      properties: { source: { type: "string", description: "The source to read; only linear." } },
      additionalProperties: false,
    },
    output: SNAPSHOT,
    async run(input, call) {
      const source = input["source"]
      if (source !== undefined && (typeof source !== "string" || source !== SOURCE)) refuseSource(runtime.plugin, String(source))
      return runtime.provider.issues({ account: call.account, now: runtime.clock(), call })
    },
  }
}
