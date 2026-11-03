import { Plugin, type Mcp } from "@opencode/plugin"
import { errorText, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { checkHost } from "./host-version.js"
import { registerToolsRpc } from "./host/tools-rpc.js"
import { watchIntegration } from "./integration.js"
import { parseOptions, type Access } from "./options.js"
import { defaultRules, registerDefaultRules } from "./permissions.js"
import { loadSkills, registerSkills } from "./skills.js"
import { readStatus, registerStatusCommand, registerStatusRpc, type ServerSource } from "./status.js"

/** Internal seam: tests point the server at a loopback fake without OAuth, and at their own skills. */
interface LinearSeam {
  readonly endpoints: Readonly<Record<Access, string>>
  readonly oauth?: false
  readonly skillsDir?: string
}

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/** No protocol, codemode, timeout or headers: the host defaults apply. */
export const serverConfig = (seam: LinearSeam, access: Access): RemoteConfig => ({
  type: "remote",
  url: seam.endpoints[access],
  oauth: seam.oauth ?? { scope: access === "write" ? "read write" : "read" },
})

/** Origin and path only, so a token in a query string never reaches status. */
export function displayUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return "an invalid URL"
  }
}

/**
 * Registers `linear`, or adopts the user's own `mcp.servers.linear` unchanged when it points at the URL for the chosen
 * access: user config is applied first, and a later `set` would replace it. Any other URL, Linear's other server
 * included, is a conflict, and nothing is added. Synchronous and never throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  config: RemoteConfig,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const existing = editor.get(SERVER_NAME)
      const expected = displayUrl(config.url)
      if (!existing) {
        editor.set(SERVER_NAME, config)
        return record({ type: "plugin", url: expected })
      }
      const url = existing.type === "remote" ? displayUrl(existing.url) : "a local command"
      record(url === expected ? { type: "adopted", url } : { type: "conflict", url, expected })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reason}).`, "Restart OpenCode."))
    }
  })
}

export function createLinearPlugin(seam: LinearSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const options = parseOptions(ctx.options)
      const host = checkHost(ctx.app.version, options.allowUntestedHost)
      const { skills, problems: skillProblems } = await loadSkills(options.access, seam.skillsDir)
      // Transforms replay on every rebuild, so each one overwrites its own entry rather than appending.
      const problems = new Map<string, string>(skillProblems.map((problem, index) => [`skill:${index}`, problem]))
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))
      let source: ServerSource | undefined

      await registerServer(ctx.mcp, serverConfig(seam, options.access), (next, problem) => {
        source = next
        report("server")(problem)
      })
      await registerDefaultRules(ctx.agent, defaultRules(), report("rules"))
      await registerSkills(ctx.skill, skills)
      const read = () => readStatus(ctx, { ...(source ? { source } : {}), access: options.access, host, problems: [...problems.values()] })
      await registerStatusCommand(ctx, read)
      await registerStatusRpc(ctx.rpc, read)
      // The plugin's own server, or the user's adopted one; a server at another URL is not Linear's for this access.
      const owned = () => source?.type === "plugin" || source?.type === "adopted"
      // Scripts call the known reads with no model, as a session and its agent.
      const stopTools = await registerToolsRpc(ctx, { mcp: { server: SERVER_NAME, managed: owned } })
      const stopWatch = watchIntegration(ctx, owned)
      return async () => {
        await stopWatch()
        await stopTools()
      }
    },
  })
}
