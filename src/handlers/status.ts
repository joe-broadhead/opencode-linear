/**
 * `status`: what a person and an app read before anything else. It carries no content and no credential.
 *
 * Account state comes from OpenCode's own MCP server list, not from a sign-in watcher: a server that is `connected` is
 * ready, one that needs a sign-in is `needs_sign_in`, and the rest are `error`. A read of status never calls Linear.
 */
import { accountStatuses, STATUS_SCHEMA, statusAnswer, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Bus } from "@we-the-rebel-alliance/plugin-contract/bus"
import type { MethodCall, MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY } from "./shared.ts"
import type { HandlerRuntime, PluginServer } from "./index.ts"

/**
 * The agents whose rules no longer hold the generated ones. The contract changed this call's answer from a list to
 * `{ ok, agents } | { ok: false, error }`; this one helper reads both, so status needs no other edit.
 */
async function unguarded(call: MethodCall): Promise<{ readonly agents: readonly string[]; readonly problem?: string }> {
  const result: unknown = await call.unguardedAgents()
  if (Array.isArray(result)) return { agents: result.filter((id): id is string => typeof id === "string") }
  if (typeof result === "object" && result !== null) {
    const held = result as { readonly ok?: unknown; readonly agents?: unknown; readonly error?: unknown }
    if (held.ok === true && Array.isArray(held.agents)) return { agents: held.agents.filter((id): id is string => typeof id === "string") }
    if (held.ok === false) return { agents: [], problem: typeof held.error === "string" ? held.error : "The agent list could not be read." }
  }
  return { agents: [], problem: "The agent list answered a shape the plugin does not read." }
}

/** Emit the plugin's state once, after setup wired the doors. */
export async function announceStatus(bus: Pick<Bus, "emit">, problems: readonly string[]): Promise<void> {
  await bus.emit("status", { state: problems.length > 0 ? "error" : "ready" })
}

/** One alias's state from OpenCode's MCP server list. */
function signalFor(server: PluginServer | undefined): AccountSignal {
  if (server === undefined) return { state: "needs_sign_in", reason: "OpenCode lists no MCP server for this alias." }
  const state = server.status.status
  if (state === "connected") return { state: "ready" }
  if (state === "needs_auth") return { state: "needs_sign_in", reason: "The Linear sign-in needs renewal." }
  if (state === "pending") return { state: "needs_sign_in", reason: "The Linear server has not connected yet." }
  if (state === "disabled") return { state: "error", reason: "The Linear server is disabled." }
  return { state: "error", reason: server.status.error ?? "The Linear server failed." }
}

/** `status`: name, version, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, OpenCode host, each account's sign-in state and any next step. It reads no Linear content.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const servers = await runtime.servers()
      const byName = new Map(servers.map((server) => [server.name, server]))
      const signals: Record<string, AccountSignal> = {}
      for (const account of runtime.accounts) signals[account.alias] = signalFor(byName.get(runtime.accountName(account.alias)))
      const accounts = accountStatuses(runtime.accounts, signals)
      // A nudge for every alias whose sign-in state a person may need to act on; the answer carries the same states.
      for (const account of accounts) if (account.state !== "ready") await call.bus.emit("account", { account: account.alias, state: account.state })
      const agents = await unguarded(call)
      const problems = [
        ...runtime.problems(),
        ...(agents.problem === undefined ? [] : [agents.problem]),
        ...accounts.filter((account) => account.state === "error").map((account) => `${account.alias}: ${account.reason ?? "the account failed"}`),
      ]
      return statusAnswer({
        manifest: runtime.manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts,
        ...(problems.length === 0 ? {} : { problems }),
        unguardedAgents: agents.agents,
      })
    },
  }
}
