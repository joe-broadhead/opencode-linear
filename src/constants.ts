import type { Access } from "./options.js"

export const PLUGIN_ID = "linear.workspace"
/** The MCP server name. Credentials are keyed by name and URL, so changing either needs a new sign-in. */
export const SERVER_NAME = "linear"
/** The name `/connect` shows for the server's sign-in. */
export const DISPLAY_NAME = "Linear"
/** Linear's MCP servers per access. The read-only one lists only reads, and Linear refuses changes through it. */
export const ENDPOINTS: Readonly<Record<Access, string>> = {
  read: "https://mcp.linear.app/mcp/readonly",
  write: "https://mcp.linear.app/mcp",
}
/** The tested OpenCode line. Equals `opencode.host` in package.json. */
export const SUPPORTED_HOST = ">=2.2.3 <2.3.0"

/** The one error shape: `CODE: What happened. Next step: What to do.` Both parts are sentences. */
export const errorText = (code: string, message: string, nextStep: string) => `${code}: ${message} Next step: ${nextStep}`

export function linearError(code: string, message: string, nextStep: string) {
  return Object.assign(new Error(errorText(code, message, nextStep)), { code, nextStep })
}
