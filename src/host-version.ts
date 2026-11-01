import { linearError, SUPPORTED_HOST } from "./constants.js"

export interface HostCheck {
  readonly version: string
  readonly tested: boolean
  /** Set when an untested host runs because `allowUntestedHost` is true. */
  readonly warning?: string
}

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/
const parse = (version: string) => RELEASE.exec(version)?.slice(1).map(Number)
const [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, ""))!)
const compare = (a: number[], b: number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

/** True for a release inside the tested line. Prereleases, dev builds and unparsable versions are untested. */
export function isTestedHost(version: string) {
  const parts = parse(version)
  return parts !== undefined && compare(parts, LOWEST!) >= 0 && compare(parts, ABOVE!) < 0
}

/** Refuses an untested host unless the user opted in, in which case the warning travels to status. */
export function checkHost(version: string, allowUntestedHost: boolean): HostCheck {
  if (isTestedHost(version)) return { version, tested: true }
  if (!allowUntestedHost) {
    throw linearError(
      "HOST_UNTESTED",
      `This plugin supports OpenCode ${SUPPORTED_HOST}, found ${version}.`,
      "Install a plugin version made for your OpenCode, or set the plugin option allowUntestedHost: true to try anyway.",
    )
  }
  const warning = `OpenCode ${version} is outside the tested line ${SUPPORTED_HOST}. The plugin runs because allowUntestedHost is true; if Linear misbehaves, use a tested OpenCode release.`
  return { version, tested: false, warning }
}
