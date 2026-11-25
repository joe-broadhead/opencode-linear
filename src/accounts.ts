/**
 * The account wiring for the `mcp` mechanism: one Linear MCP server per alias, through the contract's `accounts`
 * module.
 *
 * OpenCode holds the credentials and keys OAuth per MCP server. Every server points at Linear's one MCP endpoint; the
 * server name, `linear` for `default` and `linear-<alias>` otherwise, is what keeps two workspaces' sign-ins apart.
 */
import type { Mcp, Plugin } from "@opencode/plugin"
import { registerAccounts, type AccountsRegistration } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { mcpServerUrl } from "./provider/client.ts"

/** The context part registration needs: the two transforms a plugin's setup context has. */
export type AccountsContext = Pick<Plugin.Context, "integration" | "mcp">

/** OpenCode 2.4.1's remote server config, so the `oauth` shape below is checked against the host's own types. */
type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/**
 * One alias's server: Linear's endpoint, with OAuth, as v0.0.9 registered it.
 *
 * `oauth` is an OAuth config, never `true`: the host decodes this with `Mcp.RemoteConfig`, whose `oauth` is
 * `OAuthConfig | false | undefined`, so `oauth: true` is refused and the server never reaches `mcp.list`. The scope is
 * the one the old plugin asked for, so the same grant keeps working.
 */
export function serverConfig(name: string) {
  return { type: "remote" as const, url: mcpServerUrl(name), oauth: { scope: "read write" } } satisfies RemoteConfig
}

/** Register one MCP server per alias and return what was registered, with any problem for `status`. */
export function registerMcpAccounts(context: AccountsContext, manifest: Manifest, options: Readonly<Record<string, unknown>>): Promise<AccountsRegistration> {
  return registerAccounts(context, {
    manifest,
    options,
    server: (_account, name) => serverConfig(name),
  })
}
