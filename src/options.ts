import { linearError } from "./constants.js"

export type Access = "read" | "write"

interface Options {
  /** `read` uses Linear's read-only server and read scope; `write` uses the full server and both scopes. */
  readonly access: Access
  /** Run on an OpenCode version outside the tested line, with a warning in status. */
  readonly allowUntestedHost: boolean
}

const EXAMPLE = `"plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "write" } }]`
const ACCEPTED = {
  access: `"read" (the default) or "write"`,
  allowUntestedHost: "true or false (the default)",
} as const

const invalid = (problem: string) =>
  linearError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

/** Validates the plugin options from opencode.json. Every option is optional. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { access: "read", allowUntestedHost: false }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option "${key}". Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { access = "read", allowUntestedHost = false } = input
  if (access !== "read" && access !== "write") throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  return { access, allowUntestedHost }
}

const describe = (value: unknown) =>
  value === null ? "null" : Array.isArray(value) ? "an array" : typeof value === "string" ? JSON.stringify(value) : typeof value === "object" ? "an object" : String(value)
