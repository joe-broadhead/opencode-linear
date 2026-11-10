import type { Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { EVENTS_LIST } from "./host/events-list.js"
import { ISSUES_TOOL } from "./issues.js"
import type { Access } from "./options.js"
import { READ_TOOLS, WRITE_TOOLS } from "./linear-tools.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

/** The host's permission action for an MCP tool of the `linear` server. */
const actionOf = (tool: string) => `${SERVER_NAME}_${tool}`
const rule = (tool: string, effect: Rule["effect"]): Rule => ({ action: actionOf(tool), resource: "*", effect })

/**
 * Broad first, narrow last, because the last matching rule wins. At `access: "all"` every tool the plugin registers is
 * allowed, and so is one Linear adds later through the `linear_*` pattern; `ask-changes` asks for anything that is not
 * a read, and `read-only` denies it. The reads and the plugin's own `linear_issues` are always allowed, which is why
 * the first rule alone decides an unknown tool.
 */
export function defaultRules(access: Access = "all"): Rule[] {
  const other: Rule["effect"] = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
  return [
    rule("*", other),
    ...[...READ_TOOLS, ISSUES_TOOL, EVENTS_LIST].map((tool) => rule(tool, "allow")),
    ...WRITE_TOOLS.map((tool) => rule(tool, other)),
  ]
}

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect
const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/**
 * True when the whole default block for `access` appears, in order, anywhere after the agent's first base allow:
 * inserted by the plugin or copied by the user. Other plugins insert their blocks at the same index, so it need not
 * follow the base allow directly.
 */
export function hasDefaultRules(permissions: readonly Rule[], access: Access = "all") {
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  const block = defaultRules(access)
  if (base === -1) return false
  return permissions.some((_, start) => start > base && block.every((item, offset) => same(permissions[start + offset] ?? item, item)))
}

/**
 * Splices `rules` in right after the agent's base `* * allow`, by index. Everything later still wins: the agent's
 * own stricter rules (Plan, Explore), the user's `permissions`, and saved approvals. Agents without a base allow,
 * or that already carry the rules, are left alone. Returns whether it inserted.
 */
export function insertRules(permissions: Rule[], rules: readonly Rule[]) {
  if (hasDefaultRules(permissions)) return false
  const base = permissions.findIndex((item) => same(item, BASE_ALLOW))
  if (base === -1) return false
  permissions.splice(base + 1, 0, ...rules.map((item) => ({ ...item })))
  return true
}

/** Registers the default rules for every agent. Synchronous and never throws; a failure is kept for status. */
export function registerDefaultRules(
  agent: Pick<Plugin.Context["agent"], "transform">,
  rules: readonly Rule[],
  report: (problem: string | undefined) => void,
) {
  return agent.transform((editor) => {
    try {
      for (const { id } of editor.list()) editor.update(id, (info) => void insertRules(info.permissions, rules))
      report(undefined)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      report(errorText("RULES_NOT_ADDED", `Linear's default permission rules could not be added (${reason}), so Linear tools may run without asking.`, "Restart OpenCode."))
    }
  })
}

const wildcard = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The host's evaluation for an MCP call (resource `*`): the last matching rule wins, and no match asks. */
export function evaluate(permissions: readonly Rule[], action: string): Rule["effect"] {
  return permissions.findLast((item) => wildcard(item.action).test(action) && wildcard(item.resource).test("*"))?.effect ?? "ask"
}

/** Agents where a new Linear tool would run without asking: no default rules, and nothing else stops it. */
export const unguardedAgents = (agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], access: Access = "all") =>
  agents.filter((agent) => !hasDefaultRules(agent.permissions, access) && evaluate(agent.permissions, actionOf("new_tool")) === "allow").map((agent) => agent.id)
