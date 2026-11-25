/**
 * The handler table: one entry per method the manifest declares, by the method's name.
 *
 * A handler says what one method looks like and does the work; `register` adds the account selector, the doors, the
 * permission assertions and the answer checks. The provider is the only layer that talks to Linear.
 */
import type { AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { eventsListHandler } from "./events-list.ts"
import { issuesHandler } from "./issues.ts"
import { probeHandler } from "./probe.ts"
import { statusHandler } from "./status.ts"
import type { Provider } from "../provider/client.ts"

/** One MCP server as OpenCode lists it. Only the fields status reads. */
export interface PluginServer {
  readonly name: string
  readonly status:
    | { readonly status: "connected" }
    | { readonly status: "pending" }
    | { readonly status: "disabled" }
    | { readonly status: "failed"; readonly error?: string }
    | { readonly status: "needs_auth"; readonly error?: string }
}

/** The plugin state the handlers may read, built once in `setup`. */
export interface HandlerRuntime {
  /** The validated manifest. */
  readonly manifest: Manifest
  /** The plugin's id, as the manifest names it. */
  readonly plugin: string
  /** The installed package name, which a page states. */
  readonly packageName: string
  /** The package version, which `status` reports. */
  readonly version: string
  /** The OpenCode release the plugin runs on. */
  readonly hostVersion: string
  /** The releases the manifest's `tested` list names. */
  readonly tested: readonly string[]
  /** The accounts the options declare, in their order. */
  readonly accounts: readonly AccountProfile[]
  /** The alias's MCP server name, `<plugin>` or `<plugin>-<alias>`. */
  accountName(alias: string): string
  readonly provider: Provider
  /** The clock a page's `asOf` is stamped with; tests pass a fixed one. */
  readonly clock: () => number
  /** OpenCode's MCP servers as they are when status asks. */
  readonly servers: () => Promise<readonly PluginServer[]>
  /** Why the plugin is not ready before any account is asked, one line each. */
  problems(): readonly string[]
}

/** Every method's handler. */
export function handlersFor(runtime: HandlerRuntime): HandlerTable {
  return {
    status: statusHandler(runtime),
    probe: probeHandler(runtime),
    events_list: eventsListHandler(runtime),
    issues: issuesHandler(runtime),
  }
}
