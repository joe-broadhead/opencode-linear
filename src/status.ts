import type { Plugin, Rpc } from "@opencode/plugin"
import { errorText, PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST } from "./constants.js"
import type { HostCheck } from "./host-version.js"
import { classify } from "./linear-tools.js"
import type { Access } from "./options.js"
import { defaultRules, unguardedAgents, type Rule } from "./permissions.js"

export type Connection = "connected" | "pending" | "needs_sign_in" | "failed" | "disabled" | "not_configured"
/**
 * Who owns the `linear` server: this plugin, the user's own config (adopted unchanged), or a server at another URL than
 * the one the chosen access uses (`expected`). URLs are shown as origin and path only.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string }
  | { readonly type: "adopted"; readonly url: string }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

/** What status is built from. The TUI fills what it can see; fields it cannot see stay undefined. */
export interface StatusFacts {
  readonly server?: { readonly status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; readonly error?: string }
  readonly source?: ServerSource
  readonly account?: string
  readonly access: Access
  readonly host: HostCheck
  /** The names of the tools the `linear` server serves, without the `linear_` prefix. */
  readonly tools?: readonly string[]
  readonly agents?: readonly { readonly id: string; readonly permissions: readonly Rule[] }[]
  readonly problems?: readonly string[]
}

export interface Status {
  readonly connection: Connection
  readonly error?: string
  readonly account?: string
  readonly access: Access
  readonly source?: ServerSource
  /** How many Linear tools OpenCode lists. */
  readonly tools: number
  readonly unknownTools: readonly string[]
  readonly agentsWithoutRules: readonly string[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step; "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

export const SIGN_IN = `Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`

/** The fix for agents defined only in user config, which never receive the inserted rules: the block, one rule a line. */
export const AGENTS_FIX = [
  `Put this block first in each listed agent's own "permissions" (agents.<id>.permissions in opencode.json, or the agent file's frontmatter), followed by your top-level "permissions" rules for linear_* tools:`,
  ...defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`),
].join("\n")

export const NOTHING_TO_DO = "Nothing to do."

export function buildStatus(facts: StatusFacts): Status {
  const connection: Connection = !facts.server ? "not_configured" : facts.server.status === "needs_auth" ? "needs_sign_in" : facts.server.status
  const unknownTools = (facts.tools ?? []).filter((tool) => classify(tool) === "unknown")
  const agentsWithoutRules = unguardedAgents(facts.agents ?? [])
  const problems = facts.problems ?? []
  const status = {
    connection,
    ...(facts.server?.error ? { error: facts.server.error } : {}),
    ...(facts.account ? { account: facts.account } : {}),
    access: facts.access,
    ...(facts.source ? { source: facts.source } : {}),
    tools: facts.tools?.length ?? 0,
    unknownTools,
    agentsWithoutRules,
    host: facts.host,
    problems,
  }
  return { ...status, nextStep: nextStepOf(status) }
}

function nextStepOf(status: Omit<Status, "nextStep">): string {
  if (status.source?.type === "conflict") {
    const { url, expected } = status.source
    return `Your OpenCode config defines mcp.servers.${SERVER_NAME} with ${url}, but access "${status.access}" uses ${expected}. Point it at ${expected} or remove it, then restart OpenCode.`
  }
  switch (status.connection) {
    case "not_configured":
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "pending":
      return "Linear is still connecting. Run /linear-status again in a few seconds."
    case "needs_sign_in":
      return SIGN_IN
    case "failed":
      return "Check your network, then run /linear-status again."
  }
  if (status.agentsWithoutRules.length) return `Add the block above to each listed agent's own "permissions".`
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step becomes the status's.
  const problem = status.problems[0]?.split(" Next step: ")[1]
  if (problem) return problem
  if (!status.host.tested) return `If Linear misbehaves, use OpenCode ${SUPPORTED_HOST}.`
  return NOTHING_TO_DO
}

const CONNECTION_TEXT: Record<Connection, string> = {
  connected: "connected",
  pending: "connecting",
  needs_sign_in: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
}

const ACCESS_TEXT: Record<Access, string> = {
  read: "read-only (Linear's read-only server; changes are not available)",
  write: "read and write (each change asks before it runs)",
}

/** The server's address and owner, after the state label. */
function serverText(source: ServerSource) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}, used unchanged`
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`
}

export function formatStatus(status: Status) {
  const { source, host, unknownTools, agentsWithoutRules } = status
  const state = source?.type === "conflict" ? "conflict" : CONNECTION_TEXT[status.connection]
  const details = [status.error, source && serverText(source)].filter(Boolean).join("; ")
  // Setup notes about the plugin in this OpenCode: the untested-host warning and any setup problems.
  const notes = [host.warning, ...status.problems].filter(Boolean)
  return [
    "Linear status",
    `- Connection: ${state}${details ? ` (${details})` : ""}`,
    `- Account: ${status.account ?? "account name not reported by Linear's MCP"}`,
    `- Access: ${ACCESS_TEXT[status.access]}`,
    `- Tools: ${status.tools} available, ${unknownTools.length}${unknownTools.length ? ` unknown: ${unknownTools.join(", ")} (unknown tools ask before running)` : " unknown"}`,
    `- Agents without default rules: ${agentsWithoutRules.length ? `${agentsWithoutRules.join(", ")}. Linear tools run there without asking. ${AGENTS_FIX}` : "none"}`,
    `- OpenCode: ${host.version} (${host.tested ? "tested" : "host untested"})${notes.length ? `. ${notes.join(" ")}` : ""}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly integration: { readonly connection: Pick<Plugin.Context["integration"]["connection"], "active"> }
}

/** Reads the live facts through public host APIs. Optional lookups that fail leave their field empty. */
export async function readStatus(ctx: StatusContext, facts: Pick<StatusFacts, "source" | "access" | "host" | "problems">) {
  const [servers, agents, tools] = await Promise.all([ctx.mcp.list(), ctx.agent.list(), ctx.tool.list()])
  const server = servers.data.find((entry) => entry.name === SERVER_NAME)
  const connection = server?.integrationID ? await ctx.integration.connection.active(server.integrationID).catch(() => undefined) : undefined
  return buildStatus({
    ...facts,
    ...(server ? { server: server.status } : {}),
    ...(connection?.type === "credential" ? { account: connection.label } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME).map((tool) => tool.name),
    agents: agents.data,
  })
}

const strings = { type: "array", items: { type: "string" } }

/**
 * One read-only method for the TUI view. The TUI part does not receive the plugin options on 2.2.x, and cannot see
 * the server's own findings, so it asks the server for the same status /linear-status reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["connection", "access", "tools", "unknownTools", "agentsWithoutRules", "host", "problems", "nextStep"],
        properties: {
          connection: { enum: ["connected", "pending", "needs_sign_in", "failed", "disabled", "not_configured"] },
          error: { type: "string" },
          account: { type: "string" },
          access: { enum: ["read", "write"] },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" } },
          },
          tools: { type: "integer", minimum: 0 },
          unknownTools: strings,
          agentsWithoutRules: strings,
          host: { type: "object", required: ["version", "tested"], properties: { version: { type: "string" }, tested: { type: "boolean" }, warning: { type: "string" } } },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, { status: () => read() })
}

export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: "linear-status",
      description: "Show Linear's connection, sign-in, access mode and the next step",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (error: unknown) =>
          errorText("STATUS_UNAVAILABLE", `Could not read Linear's status (${error instanceof Error ? error.message : String(error)}).`, "Restart OpenCode, then run /linear-status again."),
        )
        await ctx.session.synthetic({ sessionID, text, description: "Linear status", resume: false })
      },
    }),
  )
}
