import { linearError } from "./constants.js"

/** What the generated default rules allow. `all` is the default; the other two are how a user restricts the plugin. */
export const ACCESS_VALUES = ["all", "ask-changes", "read-only"] as const
export type Access = (typeof ACCESS_VALUES)[number]

interface Options {
  /** What the generated default rules allow. The server and the sign-in are the same for every value. */
  readonly access: Access
  /** Run on an OpenCode version outside the tested line, with a warning in status. */
  readonly allowUntestedHost: boolean
}

const EXAMPLE = `"plugins": [{ "package": "github:we-the-rebel-alliance/linear-plugin#v0.0.0", "options": { "access": "read-only" } }]`
const ACCEPTED = {
  access: `"all" (the default), "ask-changes" or "read-only"`,
  allowUntestedHost: "true or false (the default)",
} as const

const invalid = (problem: string) =>
  linearError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { access: "all", allowUntestedHost: false }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { access = "all", allowUntestedHost = false } = input
  if (typeof access !== "string" || !(ACCESS_VALUES as readonly string[]).includes(access)) {
    throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  }
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  return { access: access as Access, allowUntestedHost }
}

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
