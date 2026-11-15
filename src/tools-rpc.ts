/**
 * Linear's part of the tools RPC (`linear.workspace.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/linear.workspace.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks
 * `linear_<tool>` against the same rules and sends OpenCode's own credential; `issues`, `events_list` and `probe` run
 * their own specs. `docs/scripting.md` describes the calls.
 */
import type { Failure, McpResult, MethodSpec, NextSteps, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN_ID as LINEAR_PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { READ_TOOLS, WRITE_TOOLS } from "./linear-tools.js"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`. */
export const PLUGIN_ID = LINEAR_PLUGIN_ID

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every known Linear tool, by its upstream name and with its class: the 41 reads as `read` and the 36 writes as
 * `write`. The class is what `describe` reports and what an approval shows; the rules, not the class, decide whether a
 * call runs. A tool Linear adds later is not a method. The plugin's own `issues`, `events_list` and `probe` are
 * `kind: "plugin"` methods, built in setup.
 */
export const METHODS: readonly MethodSpec[] = [
  ...READ_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" })),
  ...WRITE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "write" })),
]

/** What the model path's `execute.before` hooks do to an MCP call's arguments, which the executor skips. Linear has none. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** What the model path's `execute.after` hooks do to a result, which the executor skips. Linear has no such hook. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Run /linear-status, then point your own mcp.servers.${SERVER_NAME} in opencode.json at the URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: `Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`,
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: "Check your network, then run /linear-status and follow its next step.",
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /linear-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /linear-status.",
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /linear-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
}

/**
 * The plugin's own errors, thrown by the `events_list` and `probe` methods' specs (`linearError`), as a code, what
 * happened and the next step.
 */
export function pluginError(error: unknown): Failure | undefined {
  if (!(error instanceof Error)) return undefined
  const { code, detail, nextStep } = error as Error & { code?: unknown; detail?: unknown; nextStep?: unknown }
  return typeof code === "string" && typeof detail === "string" && typeof nextStep === "string" ? { code, what: detail, next: nextStep } : undefined
}

/** Linear's plugin value for the tools RPC. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
