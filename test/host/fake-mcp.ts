// A loopback Streamable-HTTP MCP server. By default it lists one read, one write and one tool the plugin has never
// seen, on both paths. With `catalog: "linear"` it lists what Linear's servers list: the read-only path every known read
// and the new tool, the full path every known read, every known write and the new tool. It answers JSON-RPC POSTs with
// plain JSON (no SSE stream) and records every tool call, its path and every request header. A `tools/call` answers
// with the tool's name, the path and its arguments as structured content; for a `query` that starts with "text", with
// text alone; or, for a `query` that starts with "fail", with an upstream error (`isError`) whose first line holds a
// signed URL. `list_issues` with assignee "me" answers in Linear's live shape: two issues and `hasNextPage`.
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"
import { READ_TOOLS, WRITE_TOOLS } from "../../src/linear-tools.js"

const schema = { type: "object", properties: { query: { type: "string" } } }
/** A tool the plugin has never seen. */
export const NEW_TOOL = { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} }
const TOOLS = [
  { name: "list_issues", description: "List issues in the workspace", annotations: { readOnlyHint: true } },
  { name: "save_issue", description: "Create or update an issue", annotations: { readOnlyHint: false, destructiveHint: false } },
  NEW_TOOL,
].map((tool) => ({ ...tool, inputSchema: { type: "object", properties: {} } }))
const linearTool = (name: string, readOnlyHint: boolean) => ({ name, description: `Linear ${name}`, annotations: { readOnlyHint }, inputSchema: schema })
const LINEAR = {
  read: [...READ_TOOLS.map((name) => linearTool(name, true)), { ...NEW_TOOL, inputSchema: schema }],
  write: [...READ_TOOLS.map((name) => linearTool(name, true)), ...WRITE_TOOLS.map((name) => linearTool(name, false)), { ...NEW_TOOL, inputSchema: schema }],
}

/** The upstream error a "fail" query gets: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Linear refused https://uploads.linear.app/a.png?signature=fake-signature-123 for this input\nTraceback: second line"

export interface FakeMcpOptions {
  /** `linear` lists Linear's known tools per path, as Linear's read-only and full servers do. */
  readonly catalog?: "linear"
}

export interface FakeMcp {
  readonly url: string
  /** Two paths on the same server, standing in for Linear's read-only and full servers. */
  readonly endpoints: { readonly read: string; readonly write: string }
  /** Tool names called, in order. */
  readonly calls: string[]
  /** Each tool call with the path it was sent to, in order. */
  readonly called: { readonly tool: string; readonly path: string }[]
  /** Each tool call's arguments, in order. */
  readonly inputs: { readonly tool: string; readonly arguments: unknown }[]
  /** The `x-linear-test` header of every request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: { query?: unknown; assignee?: unknown } } }

/** Linear's live `list_issues` answer: `id` is the identifier, `status` a name, `priority` `{ value, name }`. */
export const ASSIGNED = {
  issues: [
    { id: "ENG-1", title: "Fix login", status: "In Progress", priority: { value: 2, name: "High" }, url: "https://linear.app/acme/issue/ENG-1" },
    { id: "ENG-2", title: "Write docs", status: "Done", priority: { value: 0, name: "No priority" }, url: "https://linear.app/acme/issue/ENG-2" },
  ],
  hasNextPage: true,
  cursor: "fake-cursor",
}

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const called: { tool: string; path: string }[] = []
  const inputs: { tool: string; arguments: unknown }[] = []
  const markers: (string | undefined)[] = []
  const answer = (message: Message, path: string) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-linear", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: options.catalog === "linear" ? LINEAR[path.endsWith("/readonly") ? "read" : "write"] : TOOLS })
      case "tools/call": {
        const tool = message.params?.name ?? ""
        calls.push(tool)
        called.push({ tool, path })
        const args = message.params?.arguments ?? {}
        inputs.push({ tool, arguments: args })
        if (tool === "list_issues" && args.assignee === "me") return reply({ content: [{ type: "text", text: JSON.stringify(ASSIGNED) }], structuredContent: ASSIGNED })
        if (String(args.query ?? "").startsWith("fail")) return reply({ content: [{ type: "text", text: UPSTREAM_FAILURE }], isError: true })
        if (String(args.query ?? "").startsWith("text")) return reply({ content: [{ type: "text", text: `text from ${tool}` }] })
        return reply({ content: [{ type: "text", text: `called ${tool}` }], structuredContent: { tool, path, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const server = createServer(async (request, response) => {
    markers.push(header(request, "x-linear-test"))
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, path))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    endpoints: { read: `http://127.0.0.1:${port}/mcp/readonly`, write: `http://127.0.0.1:${port}/mcp` },
    calls,
    called,
    inputs,
    markers,
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  }
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
