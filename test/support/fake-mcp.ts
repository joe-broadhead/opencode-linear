/**
 * A loopback Streamable-HTTP MCP server for the host tests: it answers JSON-RPC `initialize`, `tools/list`,
 * `tools/call` and `ping` with plain JSON, and lists two tools. `echo` returns its arguments as structured content;
 * `fail` answers with an upstream error (`isError`), which the host rejects. It needs no OAuth.
 */
import { createServer, type IncomingMessage } from "node:http"
import type { AddressInfo } from "node:net"

interface Message {
  readonly jsonrpc: "2.0"
  readonly id?: number | string
  readonly method: string
  readonly params?: { readonly protocolVersion?: string; readonly name?: string; readonly arguments?: Readonly<Record<string, unknown>> }
}

const TOOLS = [
  { name: "echo", description: "Return the arguments it was called with", inputSchema: { type: "object", properties: { message: { type: "string" } } } },
  { name: "fail", description: "Answer with an upstream error", inputSchema: { type: "object", properties: {} } },
]

export interface FakeMcp {
  /** The MCP endpoint the host's `mcp.servers` config points at. */
  readonly url: string
  /** Tool names called, in order. */
  readonly calls: string[]
  close(): Promise<void>
}

export async function startFakeMcp(): Promise<FakeMcp> {
  const calls: string[] = []
  const answer = (message: Message) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-linear", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: TOOLS })
      case "tools/call": {
        const tool = message.params?.name ?? ""
        calls.push(tool)
        const args = message.params?.arguments ?? {}
        if (tool === "fail") return reply({ content: [{ type: "text", text: "upstream refused this call" }], isError: true })
        return reply({ content: [{ type: "text", text: JSON.stringify({ tool, arguments: args }) }], structuredContent: { tool, arguments: args } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | readonly Message[]
    const messages = Array.isArray(body) ? body : [body]
    const replies = messages.filter((message) => message.id !== undefined).map(answer)
    if (replies.length === 0) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
