import { linearError } from "./constants.js"

/** What the generated default rules allow. `all` is the default; the other two are how a user restricts the plugin. */
export const ACCESS_VALUES = ["all", "ask-changes", "read-only"] as const
export type Access = (typeof ACCESS_VALUES)[number]

/** The values the option accepted before this one. They map onto the family's values, with a note in status. */
const OLD_VALUES: Readonly<Record<string, Access>> = { read: "read-only", write: "all" }

interface Options {
  /** What the generated default rules allow, which of Linear's servers is used, and what the sign-in asks for. */
  readonly access: Access
  /** Run on an OpenCode version outside the tested line, with a warning in status. */
  readonly allowUntestedHost: boolean
  /** The note status shows when a value the option no longer documents set the access. */
  readonly deprecation?: string
}

const EXAMPLE = `"plugins": [{ "package": "github:joe-broadhead/opencode-linear#v0.0.1", "options": { "access": "read-only" } }]`
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
  if (typeof access !== "string" || (typeof access === "string" && !(ACCESS_VALUES as readonly string[]).includes(access) && !Object.hasOwn(OLD_VALUES, access))) {
    throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  }
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  // Own keys only: `constructor`, `toString` and `__proto__` are not access values.
  const old = Object.hasOwn(OLD_VALUES, access) ? OLD_VALUES[access] : undefined
  return {
    access: (old ?? access) as Access,
    allowUntestedHost,
    ...(old === undefined ? {} : { deprecation: `The access value "${access}" is deprecated: it means "${old}". Set "${old}" and sign in again.` }),
  }
}

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
