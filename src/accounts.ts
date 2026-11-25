/**
 * The account wiring for the `mcp` mechanism: one Linear MCP server per alias, through the contract's `accounts`
 * module.
 *
 * OpenCode holds the credentials and keys OAuth per MCP server. Every server points at Linear's one MCP endpoint; the
 * server name, `linear` for `default` and `linear-<alias>` otherwise, is what keeps two workspaces' sign-ins apart.
 */
import type { Plugin } from "@opencode/plugin"
import { registerAccounts, type AccountsRegistration } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { mcpServerUrl } from "./provider/client.ts"

/** The context part registration needs: the two transforms a plugin's setup context has. */
export type AccountsContext = Pick<Plugin.Context, "integration" | "mcp">

/** Register one MCP server per alias and return what was registered, with any problem for `status`. */
export function registerMcpAccounts(context: AccountsContext, manifest: Manifest, options: Readonly<Record<string, unknown>>): Promise<AccountsRegistration> {
  return registerAccounts(context, {
    manifest,
    options,
    server: (_account, name) => ({ type: "remote", url: mcpServerUrl(name), oauth: true }),
  })
}
