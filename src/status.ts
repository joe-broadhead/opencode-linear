import type { Plugin, Rpc } from "@opencode/plugin"
import { PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import { ISSUES_TOOL } from "./issues.js"
import { classify } from "./linear-tools.js"
import type { Access } from "./options.js"
import { defaultRules, unguardedAgents, type Rule } from "./permissions.js"
import { VERSION } from "./version.js"

/** The shared status labels in machine form; `/linear-status` shows them as `sign-in required` and so on. */
export type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict"
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

/**
 * One status model for `/linear-status`, the `/linear` dialog and the status RPC. `version`, `host`, `state`,
 * `unguardedAgents` and `nextStep` are the fields every plugin of this family shares; the rest are Linear's own.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly state: State
  /** For a failed connection only: OpenCode's reason, on one line of at most 160 characters, URLs without their query. */
  readonly error?: string
  readonly account?: string
  readonly access: Access
  readonly source?: ServerSource
  /** How many Linear tools OpenCode lists. */
  readonly tools: number
  /** How many of them the plugin does not know. */
  readonly unknownCount: number
  /** Up to 20 of the unknown tools' names, only those made of lowercase letters, digits and `_`. */
  readonly unknownTools: readonly string[]
  /** Agents where a new Linear tool would run without asking; empty when there are none. */
  readonly unguardedAgents: readonly string[]
  readonly host: HostCheck
  readonly problems: readonly string[]
  /** The one next step: the `Next step` row, "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

export const SIGN_IN = `Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`

/** The fix for agents defined only in user config, which never receive the inserted rules: the block, one rule a line. */
export const AGENTS_FIX = [
  `Put this block first in each listed agent's own "permissions" (agents.<id>.permissions in opencode.json, or the agent file's frontmatter), followed by your top-level "permissions" rules for linear_* tools:`,
  ...defaultRules().map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`),
].join("\n")

/** The next step while agents lack the rules. It stands alone in the RPC, so it repeats the fix's order. */
export const AGENTS_NEXT_STEP = `Put the block first in each listed agent's own "permissions", followed by your top-level rules for linear_* tools.`

export const NOTHING_TO_DO = "Nothing to do."

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`
const LISTED_UNKNOWN = 20
// A tool name comes from the server; list only plain names.
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/
const REASON_LIMIT = 160

/** OpenCode's failure text as a short reason: one line, URLs without their query or fragment, at most 160 characters. */
export function shortReason(text: string): string | undefined {
  const reason = text
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/[?#].*$/s, ""))
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
  if (reason === "") return undefined
  return reason.length > REASON_LIMIT ? `${reason.slice(0, REASON_LIMIT - 1)}…` : reason
}

const STATE_OF = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" } as const

export function buildStatus(facts: StatusFacts): Status {
  const state: State = facts.source?.type === "conflict" ? "conflict" : facts.server ? STATE_OF[facts.server.status] : "not_configured"
  // linear_issues is the plugin's own tool in the server's namespace, not one the server added.
  const unknown = (facts.tools ?? []).filter((tool) => tool !== ISSUES_TOOL && classify(tool) === "unknown")
  // OpenCode's text for a needed sign-in can hold an authorization URL, so only a failure's reason is kept.
  const error = facts.server?.status === "failed" && facts.server.error ? shortReason(facts.server.error) : undefined
  const status = {
    version: VERSION,
    state,
    ...(error ? { error } : {}),
    ...(facts.account ? { account: facts.account } : {}),
    access: facts.access,
    ...(facts.source ? { source: facts.source } : {}),
    tools: facts.tools?.length ?? 0,
    unknownCount: unknown.length,
    unknownTools: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    unguardedAgents: unguardedAgents(facts.agents ?? []),
    host: facts.host,
    problems: facts.problems ?? [],
  }
  return { ...status, nextStep: nextStepOf(status) }
}

function nextStepOf(status: Omit<Status, "nextStep">): string {
  switch (status.state) {
    case "conflict": {
      const { url, expected } = status.source as Extract<ServerSource, { type: "conflict" }>
      return `Your OpenCode config defines mcp.servers.${SERVER_NAME} with ${url}, but access "${status.access}" uses ${expected}. Point it at ${expected} or remove it, then restart OpenCode.`
    }
    case "not_configured":
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
    case "disabled":
      return `The ${SERVER_NAME} MCP server is disabled. Enable it in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "connecting":
      return "Linear is still connecting. Run /linear-status again in a few seconds."
    case "sign_in_required":
      return SIGN_IN
    case "failed":
      return "Check your network, then run /linear-status again."
  }
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  // A problem reads `CODE: What happened. Next step: What to do.`; its own next step becomes the status's.
  const problem = status.problems[0]?.split(" Next step: ")[1]
  if (problem) return problem
  if (!status.host.tested) return `If Linear misbehaves, use OpenCode ${TESTED_TEXT}, the tested releases.`
  return NOTHING_TO_DO
}

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
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

function toolsText({ tools, unknownCount, unknownTools }: Status) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`
  const more = unknownCount - unknownTools.length
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  return `${tools} available, ${unknownCount} unknown${names} (unknown tools ask before running)`
}

/** The OpenCode row: the version, whether it is tested, the supported range, then any setup problems. */
function hostText({ host, problems }: Status) {
  const { version, range, tested } = host
  const outside = version === null || !isSupportedHost(version)
  const notes = [
    ...(outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Linear misbehaves, use OpenCode ${TESTED_TEXT}.`] : []),
    ...problems,
  ]
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`
}

export function formatStatus(status: Status) {
  const { source, unguardedAgents: agents } = status
  const details = [status.error, source && serverText(source)].filter(Boolean).join("; ")
  return [
    "Linear status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.account ?? "account name not reported by Linear's MCP"}`,
    `- Access: ${ACCESS_TEXT[status.access]}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}. Linear tools run there without asking. ${AGENTS_FIX}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
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

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
export function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: `STATUS_UNAVAILABLE: Could not read Linear's status${reason ? ` (${reason})` : ""}.`,
    nextStep: "Restart OpenCode, then run /linear-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }

/**
 * One read-only method for the TUI view and scripts. The TUI part does not receive the plugin options on 2.2.x, and
 * cannot see the server's own findings, so it asks the server for the same status /linear-status reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "access", "tools", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          account: { type: "string" },
          access: { enum: ["read", "write"] },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" } },
          },
          tools: count,
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: { type: ["string", "null"] }, range: { type: "string" }, tested: { type: "boolean" } },
          },
          problems: strings,
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
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
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "Linear status", resume: false })
      },
    }),
  )
}
