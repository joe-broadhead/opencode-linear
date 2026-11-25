/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts and one `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts, generates the access rules and builds the bus. This
 * file never calls `ctx.tool`, `ctx.rpc` or `ctx.permission` itself.
 */
import { Plugin } from "@opencode/plugin"
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerMcpAccounts } from "./accounts.ts"
import { announceStatus } from "./handlers/status.ts"
import { handlersFor } from "./handlers/index.ts"
import { manifest, packageName, version } from "./manifest.ts"
import { createProvider, createToolRead } from "./provider/client.ts"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = context.options ?? {}
    const plan = accountsOf(manifest, options)
    if (!plan.ok) throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)

    // The vendor's MCP server holds the credentials: one server per alias, named linear or linear-<alias>.
    const accounts = await registerMcpAccounts(context, manifest, options)
    const problems = [...accounts.problems]
    const provider = createProvider({
      plugin: manifest.plugin.name,
      package: packageName,
      read: createToolRead({ plugin: manifest.plugin.name, tools: context.tool }),
    })

    const handlers = handlersFor({
      manifest,
      plugin: manifest.plugin.name,
      packageName,
      version,
      hostVersion: context.app.version,
      tested: manifest.plugin.host.tested,
      accounts: plan.value.accounts,
      accountName: (alias) => accountName(manifest.plugin.name, alias),
      provider,
      clock: Date.now,
      servers: async () => (await context.mcp.list()).data.map((server) => ({ name: server.name, status: server.status })),
      problems: () => problems,
    })

    const registration = await register(context, manifest, handlers)
    await announceStatus(registration.bus, problems)
    return () => registration.dispose()
  },
})
