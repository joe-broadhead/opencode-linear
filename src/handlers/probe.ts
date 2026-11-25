/** `probe`: whose an account is. It reads the account and its workspace, never any content. */
import { parseProbeInput, PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { refuseInput, refuseSource } from "./shared.ts"
import { SOURCE } from "../provider/client.ts"
import type { HandlerRuntime } from "./index.ts"

/** `probe`: the signed-in owner for one account. */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the signed-in Linear owner and workspace for one account. Use it to tell aliases apart; it reads no issue.",
    input: {
      type: "object",
      properties: { source: { type: "string", description: "The source to probe; only linear." } },
      additionalProperties: false,
    },
    output: PROBE_SCHEMA,
    async run(input, call) {
      const parsed = parseProbeInput(input)
      if (!parsed.ok) refuseInput(parsed.problems)
      if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) refuseSource(runtime.plugin, parsed.value.source)
      return runtime.provider.probe(call.account, call)
    },
  }
}
