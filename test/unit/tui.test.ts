// The TUI status view against a narrow fake of the members it uses: the /linear command, the status text from
// the server's RPC, refreshes while open, and cleanup.
import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { buildStatus, formatStatus, SIGN_IN, StatusRpc, type Status } from "../../src/status.js"
import tui, { setupView, TUI_ID, viewMessage, type ViewContext } from "../../src/tui.js"

const status = (overrides: Partial<Parameters<typeof buildStatus>[0]> = {}): Status =>
  buildStatus({ server: { status: "connected" }, source: { type: "plugin", url: "https://mcp.linear.app/mcp/readonly" }, access: "read", host: checkHost("2.2.3", false), ...overrides })

/** Everything the view touches, recorded. */
function fake(options: { answer?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  const alerts: { title: string; message: string; close: () => void }[] = []
  const sizes: unknown[] = []
  const layers: unknown[] = []
  const calls: unknown[] = []
  let cleared = 0
  let answer = options.answer ?? (async () => status())
  const context: ViewContext = {
    location: { directory: "/project" } as ViewContext["location"],
    client: {
      rpc: ((definition: { id: string }) => ({
        status: (input: unknown, request: unknown) => (calls.push({ id: definition.id, input, request }), answer()),
      })) as unknown as ViewContext["client"]["rpc"],
    },
    data: {
      on: ((type: string, handler: (event: unknown) => void) => {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])
        return () => handlers.set(type, handlers.get(type)!.filter((item) => item !== handler))
      }) as ViewContext["data"]["on"],
    },
    ui: {
      dialog: {
        alert: (alert) => new Promise((resolve) => void alerts.push({ ...alert, close: () => resolve() })),
        set: (value) => void sizes.push(value),
        clear: () => void cleared++,
      },
    },
    keymap: { layer: (factory) => void layers.push(factory()) },
  }
  const emit = (type: string, event: unknown = {}) => (handlers.get(type) ?? []).forEach((handler) => handler(event))
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return {
    context,
    alerts,
    sizes,
    layers,
    calls,
    handlers,
    emit,
    settle,
    cleared: () => cleared,
    setAnswer: (next: () => Promise<unknown>) => void (answer = next),
  }
}

type Command = { run: () => Promise<void> | void; enabled?: () => boolean }
const command = (layers: unknown[]) => (layers[0] as { commands: Command[] }).commands[0]!
const refreshKey = (layers: unknown[]) => (layers[0] as { commands: Command[] }).commands[1]!

describe("TUI plugin", () => {
  test("the TUI entry is the status view with its stable ID", () => {
    expect(tui.id).toBe("linear.workspace.tui")
    expect(TUI_ID).toBe("linear.workspace.tui")
    expect(tui.setup).toBe(setupView as never)
  })

  test("adds one global palette and /linear command, and an r key that is live only while the view is open", async () => {
    const view = fake()
    setupView(view.context)
    expect(view.layers).toEqual([
      {
        mode: "global",
        commands: [
          {
            id: "linear.workspace.status",
            title: "Linear: Status",
            description: "Sign-in, account, access, tools and the next step for Linear",
            group: "Linear",
            palette: true,
            slash: { name: "linear" },
            run: expect.any(Function),
          },
          { id: "linear.workspace.status.refresh", title: "Refresh Linear status", group: "Linear", bind: "r", enabled: expect.any(Function), run: expect.any(Function) },
        ],
      },
    ])
    const key = refreshKey(view.layers)
    expect(key.enabled!()).toBe(false)
    await command(view.layers).run()
    expect(key.enabled!()).toBe(true)
    view.setAnswer(async () => status({ access: "write" }))
    key.run()
    await view.settle()
    expect(view.alerts).toHaveLength(2)
    expect(view.alerts[1]!.message).toContain("- Access: read and write")
    view.alerts[1]!.close()
    await view.settle()
    expect(key.enabled!()).toBe(false)
  })
})

describe("status view", () => {
  test("shows the server's status, the same text as /linear-status without its heading, in a large dialog", async () => {
    const answer = status({ server: { status: "needs_auth", error: "Authorization required" }, access: "write", agents: [{ id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }] }] })
    const view = fake({ answer: async () => answer })
    setupView(view.context)
    await command(view.layers).run()
    expect(view.calls.at(-1)).toEqual({ id: StatusRpc.id, input: {}, request: { location: { directory: "/project" } } })
    expect(view.alerts).toHaveLength(1)
    expect(view.alerts[0]!.title).toBe("Linear status")
    expect(view.alerts[0]!.message).toBe(`${formatStatus(answer).split("\n").slice(1).join("\n")}\n\nr refresh · esc close`)
    expect(view.alerts[0]!.message).toContain(`- Next step: ${SIGN_IN}`)
    expect(view.alerts[0]!.message).toContain("- Access: read and write")
    expect(view.alerts[0]!.message).toContain("- Agents without default rules: reviewer.")
    expect(view.sizes.at(-1)).toEqual({ size: "large" })
  })

  test("an untested host the user allowed shows the warning", () => {
    const untested = status({ host: checkHost("2.3.0", true) })
    expect(viewMessage({ status: untested })).toContain(`- OpenCode: 2.3.0 (host untested). ${untested.host.warning}`)
  })

  test.each([
    [{ type: "rpc.unavailable", message: "x" }, "STATUS_UNAVAILABLE: The Linear plugin is not running on this OpenCode server. Next step: Run /plugins to see why it did not start."],
    [{ type: "rpc.method_not_found", message: "x" }, "STATUS_UNAVAILABLE: The Linear plugin is not running on this OpenCode server. Next step: Run /plugins to see why it did not start."],
    [new Error("socket closed"), "STATUS_UNAVAILABLE: Could not read Linear's status (socket closed). Next step: Restart OpenCode, then run /linear again."],
    ["timeout", "STATUS_UNAVAILABLE: Could not read Linear's status (timeout). Next step: Restart OpenCode, then run /linear again."],
  ])("a failed status request (%j) shows a coded error with a next step", async (error, message) => {
    const view = fake({ answer: () => Promise.reject(error) })
    setupView(view.context)
    await command(view.layers).run()
    expect(view.alerts[0]!.message).toBe(`${message}\n\nr refresh · esc close`)
  })

  test.each(["mcp.status.changed", "server.connected", "agent.updated", "integration.updated", "credential.updated", "credential.switched"])("an open view redraws on %s", async (type) => {
    const view = fake()
    setupView(view.context)
    await command(view.layers).run()
    view.setAnswer(async () => status({ access: "write" }))
    view.emit(type, { data: { server: "linear" } })
    await view.settle()
    expect(view.alerts).toHaveLength(2)
    expect(view.alerts[1]!.message).toContain("- Access: read and write")
  })

  test("listens to events only while the view is open", async () => {
    const view = fake()
    setupView(view.context)
    const listening = () => [...view.handlers.values()].flat().length
    expect(listening()).toBe(0)
    await command(view.layers).run()
    expect(listening()).toBe(6)
    await command(view.layers).run()
    expect(listening()).toBe(6)
    view.alerts.at(-1)!.close()
    await view.settle()
    expect(listening()).toBe(0)
  })

  test("a closed view is not reopened, and other servers' changes are ignored", async () => {
    const view = fake()
    setupView(view.context)
    view.emit("mcp.status.changed", { data: { server: "linear" } })
    await view.settle()
    expect(view.alerts).toHaveLength(0)
    await command(view.layers).run()
    view.emit("mcp.status.changed", { data: { server: "github" } })
    await view.settle()
    expect(view.alerts).toHaveLength(1)
    view.alerts[0]!.close()
    await view.settle()
    view.emit("agent.updated")
    await view.settle()
    expect(view.alerts).toHaveLength(1)
  })

  test("a slow answer never replaces a newer one", async () => {
    let release: (value: Status) => void = () => {}
    const view = fake({ answer: () => new Promise((resolve) => (release = resolve)) })
    setupView(view.context)
    const first = command(view.layers).run()
    const releaseFirst = release
    view.setAnswer(async () => status({ access: "write" }))
    await command(view.layers).run()
    releaseFirst(status())
    await first
    expect(view.alerts.map((alert) => alert.message.includes("- Access: read and write"))).toEqual([true])
  })

  test("cleanup stops listening and closes an open view", async () => {
    const view = fake()
    const cleanup = setupView(view.context)
    await command(view.layers).run()
    cleanup()
    expect([...view.handlers.values()].flat()).toHaveLength(0)
    expect(view.cleared()).toBe(1)
    const closed = fake()
    setupView(closed.context)()
    expect(closed.cleared()).toBe(0)
  })
})
