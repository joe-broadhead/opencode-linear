// docs/scripting.md and the README's scripting example are the contract a script author copies. Every example must use
// a method this plugin registers, carry the location header and the strict envelope, and name only fields that method
// accepts, so a doc example cannot drift from the code.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { METHODS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { ISSUES_TOOL } from "../../src/issues.js"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const FILES = ["docs/scripting.md", "README.md"]
// `issues` is appended to the table at registration, so it is a method without being in METHODS.
const METHODS_BY_NAME = new Map(METHODS.map((method) => [method.name, method]))
const known = (name: string) => METHODS_BY_NAME.has(name) || name === ISSUES_TOOL || name === "describe"

type Example = { file: string; line: number; method: string; body: unknown; statement: string }

/** Every `opencode api post /api/rpc/…` call in a file, as its method name and its parsed body. */
function calls(text: string): Example[] {
  const out: Example[] = []
  for (const match of text.matchAll(/opencode api post \/api\/rpc\/([A-Za-z0-9.]+)\/([A-Za-z0-9_]+)/g)) {
    const start = match.index!
    // A statement runs to the end of its fenced block or the next blank line.
    const rest = text.slice(start)
    const end = rest.search(/\n\s*\n|\n```/)
    const statement = (end === -1 ? rest : rest.slice(0, end)).trim()
    out.push({ file: "", line: text.slice(0, start).split("\n").length, method: match[2]!, body: bodyOf(statement), statement })
  }
  return out
}

/** The `-d '{…}'` body of a statement, by matching braces. */
function bodyOf(statement: string): unknown {
  const at = statement.indexOf("-d '{")
  if (at === -1) return undefined
  let depth = 0
  let inString = false
  for (let i = at + 4; i < statement.length; i++) {
    const char = statement[i]
    if (inString) {
      if (char === "\\") i++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(statement.slice(at + 4, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/** The method's input, from the envelope's inner `input`. */
function toolInput(body: unknown): unknown {
  const envelope = (body as { input?: { input?: unknown } } | undefined)?.input
  return envelope !== undefined && "input" in envelope ? envelope.input : undefined
}

const examples = FILES.flatMap((file) => calls(readFileSync(join(ROOT, file), "utf8")).map((call) => ({ ...call, file })))

describe("the scripting examples", () => {
  test("there are examples to check", () => {
    expect(examples.length).toBeGreaterThan(2)
    expect(TOOLS_RPC_ID).toBe("linear.workspace.tools")
    // The methods table plus the plugin's own `issues`, which src/plugin.ts appends at registration.
    expect(METHODS.map((method) => method.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
  })

  test.each(examples)("$file:$line calls $method with this plugin's RPC id and a real method", (example) => {
    expect(example.statement).toContain(`/api/rpc/${TOOLS_RPC_ID}/`)
    expect({ line: example.line, known: known(example.method) }).toEqual({ line: example.line, known: true })
  })

  test.each(examples)("$file:$line sends the location header", (example) => {
    expect(example.statement).toContain('-H "x-opencode-directory:$PWD"')
  })

  test.each(examples)("$file:$line sends the strict envelope", (example) => {
    const envelope = (example.body as { input?: Record<string, unknown> } | undefined)?.input
    expect(envelope).toBeDefined()
    // `describe` takes nothing, or a session; every other method takes the session and the tool's input.
    const keys = Object.keys(envelope!).sort()
    expect(example.method === "describe" ? [["sessionID"], []] : [["input", "sessionID"]]).toContainEqual(keys)
    if (example.method !== "describe") expect(typeof envelope!["sessionID"]).toBe("string")
  })

  // A Linear method's input is Linear's, which the plugin does not hold: the test proves the method is one it
  // registers, and that the example's input is a JSON object. `issues` is the plugin's own, so its input is checked.
  test.each(examples.filter((example) => example.method !== "describe"))("$file:$line names only fields $method accepts", (example) => {
    const input = toolInput(example.body)
    expect(typeof input).toBe("object")
    if (example.method !== ISSUES_TOOL) return
    const limit = (input as Record<string, unknown>).limit
    expect(limit === undefined || (typeof limit === "number" && limit >= 1 && limit <= 100)).toBe(true)
    expect(Object.keys(input as Record<string, unknown>).filter((key) => key !== "limit")).toEqual([])
  })
})
