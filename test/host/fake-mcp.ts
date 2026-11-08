// A loopback Streamable-HTTP MCP server. By default it lists one read, one write and one tool the plugin has never
// seen, on both paths. With `catalog: "linear"` it lists what Linear's servers list: the read-only path every known read
// and the new tool, the full path every known read, every known write and the new tool. It answers JSON-RPC POSTs with
// plain JSON (no SSE stream) and records every tool call, its path and every request header. A `tools/call` answers
// with the tool's name, the path and its arguments as structured content; for a `query` that starts with "text", with
// text alone; or, for a `query` that starts with "fail", with an upstream error (`isError`) whose first line holds a
// signed URL. `list_issues` with assignee "me" answers in Linear's live shape: two issues and `hasNextPage`.
//
// While `challenge` is set, every MCP request gets 401 with the bearer challenge a server sends before a sign-in or
// after its tokens are revoked, and the same server plays the sign-in server: protected-resource metadata, and an
// authorization server at `/oauth` that registers clients dynamically, so a host test can complete OpenCode's sign-in.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
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

/** The scope the plugin asks for on a read access, and the fake's challenge names. */
export const SCOPES = "read"

export interface FakeMcpOptions {
  /** `linear` lists Linear's known tools per path, as Linear's read-only and full servers do. */
  readonly catalog?: "linear"
  /**
   * Whether the token endpoint issues a refresh token. Without one, a 401 later needs a new sign-in and leaves the
   * credential in place, which is the `/connect` account the plugin marks.
   */
  readonly refreshTokens?: boolean
}

export interface FakeMcp {
  readonly url: string
  /** Two paths on the same server, standing in for Linear's read-only and full servers. */
  readonly endpoints: { readonly all: string; readonly "ask-changes": string; readonly "read-only": string }
  /**
   * While true, every MCP request gets 401 with a bearer challenge, as Linear's server answers before a sign-in or
   * after its tokens are revoked. The sign-in server keeps answering.
   */
  challenge: boolean
  /** The server's origin; `${origin}/oauth` is the authorization server. */
  readonly origin: string
  /** Every token request's form, in order. */
  readonly tokens: Record<string, string>[]
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
  const tokens: Record<string, string>[] = []
  let codes = 0
  // Filled once the server listens; the request handler reads `challenge`, `url` and `origin` from it.
  const fake = { challenge: false } as FakeMcp
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
  /** The sign-in server: the resource's metadata, and an authorization server at `/oauth`. */
  const signIn = async (request: IncomingMessage, response: ServerResponse, route: string) => {
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))
    const issuer = `${fake.origin}/oauth`
    if (route.startsWith("/.well-known/oauth-protected-resource")) {
      // The resource is the server path the challenge came from, such as Linear's read-only path.
      const resource = `${fake.origin}${route.slice("/.well-known/oauth-protected-resource".length) || "/mcp"}`
      return json(200, { resource, authorization_servers: [issuer], scopes_supported: SCOPES.split(" "), bearer_methods_supported: ["header"] })
    }
    if (["/.well-known/oauth-authorization-server/oauth", "/.well-known/openid-configuration/oauth", "/oauth/.well-known/openid-configuration", "/oauth/.well-known/oauth-authorization-server"].includes(route)) {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
        scopes_supported: SCOPES.split(" "),
      })
    }
    // Like a signed-in browser: the authorization endpoint sends the loopback callback a code, and the token endpoint
    // exchanges it for an access token.
    if (route === "/oauth/authorize") {
      const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams
      const target = new URL(query.get("redirect_uri") ?? "/")
      target.searchParams.set("code", `fake-code-${++codes}`)
      if (query.get("state")) target.searchParams.set("state", query.get("state")!)
      return void response.writeHead(302, { location: target.toString() }).end()
    }
    if (route === "/oauth/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await read(request)))
      tokens.push(form)
      // While the server challenges, a refresh is refused like a revoked token: the person must sign in again.
      if (fake.challenge && form.grant_type === "refresh_token") return json(400, { error: "invalid_grant" })
      return json(200, {
        access_token: `fake-access-${tokens.length}`,
        token_type: "Bearer",
        expires_in: 3600,
        ...(options.refreshTokens === false ? {} : { refresh_token: `fake-refresh-${tokens.length}` }),
        scope: SCOPES,
      })
    }
    if (route === "/oauth/register" && request.method === "POST") {
      const body = JSON.parse(await read(request)) as Record<string, unknown>
      return json(201, { ...body, client_id: "fake-client", client_id_issued_at: 0 })
    }
    return json(404, { error: "not_found" })
  }
  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route.startsWith("/.well-known/") || route.startsWith("/oauth")) return signIn(request, response, route)
    markers.push(header(request, "x-linear-test"))
    if (fake.challenge) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource${route}`
      return void response
        .writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}", scope="${SCOPES}"` })
        .end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | Message[]
    const replies = (Array.isArray(body) ? body : [body]).filter((message) => message.id !== undefined).map((message) => answer(message, route))
    if (!replies.length) return void response.writeHead(202).end()
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    endpoints: { all: `http://127.0.0.1:${port}/mcp`, "ask-changes": `http://127.0.0.1:${port}/mcp`, "read-only": `http://127.0.0.1:${port}/mcp/readonly` },
    origin: `http://127.0.0.1:${port}`,
    tokens,
    calls,
    called,
    inputs,
    markers,
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
