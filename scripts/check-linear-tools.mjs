// Maintainer-run drift check against Linear's live MCP tool list. It warns; nothing at runtime depends on it.
//
//   LINEAR_API_KEY=<read-only key> npm run drift -- [--strict] [--endpoint <url>]
//
// Sends initialize and tools/list with a bearer header from the environment, compares the served tool names with
// READ_TOOLS and WRITE_TOOLS in src/linear-tools.ts, and prints only tool names and Linear's readOnlyHint and
// destructiveHint annotations. It stores nothing. Exit codes: 0 no drift, or drift without --strict;
// 1 drift with --strict; 2 usage, sign-in or connection error.
// Needs Node 22.18 or later, which loads src/linear-tools.ts by stripping its types.
import { readFileSync } from "node:fs"

const DEFAULT_ENDPOINT = "https://mcp.linear.app/mcp"
const PROTOCOL_VERSION = "2025-06-18"
const USAGE = "Usage: LINEAR_API_KEY=<read-only key> node scripts/check-linear-tools.mjs [--strict] [--endpoint <url>]"
const TIMEOUT_MS = 30_000
const MAX_PAGES = 50

let strict = false
let endpoint = DEFAULT_ENDPOINT
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--strict") strict = true
  else if (args[i] === "--endpoint" && args[i + 1]) endpoint = args[++i]
  else fail(`unknown argument "${args[i]}". ${USAGE}`)
}

const url = parseEndpoint(endpoint)
const key = process.env.LINEAR_API_KEY?.trim()
if (!key) fail(`LINEAR_API_KEY is not set. Create a read-only personal API key in Linear (Settings, Security & access), then rerun. ${USAGE}`)
if (!process.features.typescript) fail(`Node ${process.versions.node} cannot load src/linear-tools.ts. Use Node 22.18 or later.`)

const classified = await loadClassification()
const client = { session: undefined, version: PROTOCOL_VERSION, nextId: 1 }
const live = new Map()
try {
  const init = await request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "opencode-linear-drift-check", version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version },
  })
  if (typeof init?.protocolVersion === "string") client.version = init.protocolVersion
  await notify("notifications/initialized")
  let cursor
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await request("tools/list", cursor ? { cursor } : {})
    for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
      if (typeof tool?.name === "string") live.set(tool.name, tool.annotations ?? {})
    }
    cursor = typeof result?.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined
    if (!cursor) break
    if (page === MAX_PAGES - 1) fail(`tools/list returned more than ${MAX_PAGES} pages.`)
  }
} finally {
  await closeSession()
}

const known = new Set([...classified.read, ...classified.write])
const unclassified = [...live.keys()].filter((name) => !known.has(name)).sort()
const removed = [...known].filter((name) => !live.has(name)).sort()
const conflicts = [...live].filter(([name, hints]) =>
  (classified.read.has(name) && (hints.readOnlyHint === false || hints.destructiveHint === true))
  || (classified.write.has(name) && hints.readOnlyHint === true)).map(([name]) => name).sort()

console.log(`Linear MCP serves ${live.size} tools: ${[...live.keys()].filter((name) => classified.read.has(name)).length} classified read, `
  + `${[...live.keys()].filter((name) => classified.write.has(name)).length} classified write, ${unclassified.length} unclassified.`)
section("Unclassified: served by Linear, in neither READ_TOOLS nor WRITE_TOOLS (added upstream or never classified)", unclassified, true)
section("Removed: listed in src/linear-tools.ts, no longer served by Linear", removed, false)
section("Hint conflicts: the classification disagrees with Linear's annotations", conflicts, true)

const drift = unclassified.length + removed.length + conflicts.length
if (!drift) {
  console.log("No drift.")
  process.exit(0)
}
console.log(`\nDrift: ${drift} tool name(s). Classify or remove them in src/linear-tools.ts after checking each tool's behaviour.`)
process.exit(strict ? 1 : 0)

function section(title, names, withHints) {
  if (!names.length) return
  console.log(`\n${title}:`)
  for (const name of names) console.log(`  ${printable(name)}${withHints && live.has(name) ? `  ${hints(live.get(name))}` : ""}`)
}

function hints(annotations) {
  const show = (value) => (typeof value === "boolean" ? String(value) : "unset")
  return `readOnlyHint=${show(annotations.readOnlyHint)} destructiveHint=${show(annotations.destructiveHint)}`
}

// Tool names come from the network: print plain identifiers as is and quote anything else.
function printable(name) {
  return /^[A-Za-z0-9_.\-]{1,128}$/.test(name) ? name : JSON.stringify(name.slice(0, 128))
}

async function loadClassification() {
  let module
  try {
    module = await import(new URL("../src/linear-tools.ts", import.meta.url).href)
  } catch (error) {
    fail(`cannot load src/linear-tools.ts (${error?.code ?? error?.message ?? error}). Keep that file free of runtime imports so Node can strip its types.`)
  }
  const list = (name) => {
    const value = module[name]
    if (!value || typeof value[Symbol.iterator] !== "function" || typeof value === "string") fail(`src/linear-tools.ts must export ${name} as an array or set of tool names.`)
    return new Set(value)
  }
  return { read: list("READ_TOOLS"), write: list("WRITE_TOOLS") }
}

function parseEndpoint(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail(`--endpoint "${value}" is not a URL. ${USAGE}`)
  }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    fail("--endpoint must use https, or http on a loopback address; the API key is sent as a bearer header.")
  }
  return parsed
}

function headers(extra = {}) {
  return {
    authorization: `Bearer ${key}`,
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    ...(client.session ? { "mcp-session-id": client.session } : {}),
    ...extra,
  }
}

async function post(body, method) {
  let response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: headers(method === "initialize" ? {} : { "mcp-protocol-version": client.version }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    fail(`${method}: cannot reach ${url.origin} (${clean(error?.cause?.code ?? error?.cause?.message ?? error?.message)}).`)
  }
  client.session = response.headers.get("mcp-session-id") ?? client.session
  if (response.status === 401 || response.status === 403) {
    fail(`Linear rejected LINEAR_API_KEY (HTTP ${response.status}). Check the key, or create a new read-only key, then rerun.`)
  }
  if (!response.ok) fail(`${method}: Linear answered HTTP ${response.status}.`)
  return response
}

async function notify(method) {
  const response = await post({ jsonrpc: "2.0", method }, method)
  await response.body?.cancel()
}

async function request(method, params) {
  const id = client.nextId++
  const response = await post({ jsonrpc: "2.0", id, method, params }, method)
  const type = response.headers.get("content-type") ?? ""
  const message = type.includes("text/event-stream") ? await fromEventStream(response, id) : await response.json().catch(() => undefined)
  if (!message || message.id !== id) fail(`${method}: Linear sent no matching response.`)
  if (message.error) fail(`${method}: JSON-RPC error ${message.error.code ?? "unknown"} (${clean(message.error.message)}).`)
  return message.result
}

// Reads server-sent events until the response with this id arrives, then stops reading.
async function fromEventStream(response, id) {
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (value) buffer += value.replace(/\r\n?/g, "\n")
      let end
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n")
        if (!data) continue
        let message
        try {
          message = JSON.parse(data)
        } catch {
          continue
        }
        if (message?.id === id) return message
      }
      if (done) return undefined
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

async function closeSession() {
  if (!client.session) return
  await fetch(url, { method: "DELETE", headers: headers({ "mcp-protocol-version": client.version }), signal: AbortSignal.timeout(5_000) })
    .then((response) => response.body?.cancel())
    .catch(() => {})
}

function clean(text) {
  return String(text ?? "no message").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200)
}

function fail(message) {
  console.error(`check-linear-tools: ${message}`)
  process.exit(2)
}
