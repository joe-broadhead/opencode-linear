// A loopback Streamable-HTTP MCP server with one read, one write and one tool the plugin has never seen.
// It answers JSON-RPC POSTs with plain JSON (no SSE stream) and records every tool call and request header.
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"

const TOOLS = [
  { name: "list_issues", description: "List issues in the workspace", annotations: { readOnlyHint: true } },
  { name: "save_issue", description: "Create or update an issue", annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "shiny_new_tool", description: "A tool added upstream after the tool lists were written", annotations: {} },
].map((tool) => ({ ...tool, inputSchema: { type: "object", properties: {} } }))

export interface FakeMcp {
  readonly url: string
  /** Two paths on the same server, standing in for Linear's read-only and full servers. */
  readonly endpoints: { readonly read: string; readonly write: string }
  /** Tool names called, in order. */
  readonly calls: string[]
  /** The `x-linear-test` header of every request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string } }

export async function startFakeMcp(): Promise<FakeMcp> {
  const calls: string[] = []
  const markers: (string | undefined)[] = []
  const answer = (message: Message) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-linear", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: TOOLS })
      case "tools/call":
        calls.push(message.params?.name ?? "")
        return reply({ content: [{ type: "text", text: `called ${message.params?.name}` }] })
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const server = createServer(async (request, response) => {
    markers.push(header(request, "x-linear-test"))
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map(answer)
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    endpoints: { read: `http://127.0.0.1:${port}/mcp/readonly`, write: `http://127.0.0.1:${port}/mcp` },
    calls,
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
