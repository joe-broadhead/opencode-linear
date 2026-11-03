# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The tools RPC, `linear.workspace.tools`: a script can call Linear's 42 known read tools with no model, through
  `opencode api`, as a session and its agent, with either access. It gets exactly the access that agent's model has:
  a tool its rules hide is refused, OpenCode checks each call against the agent's and the session's rules, and an ask
  is refused at once because no one is there to answer it. `describe` lists the methods with each tool's live input
  schema. Linear's write tools and tools Linear adds later are never methods. `docs/scripting.md` explains it.

## [0.0.0] - 2026-11-01

### Added

- Registers Linear's official MCP server under the name `linear`: the read-only server
  `https://mcp.linear.app/mcp/readonly` with the `read` scope by default, or `https://mcp.linear.app/mcp` with
  `read write` when `access` is `"write"`.
- Names the server's sign-in "Linear" in `/connect`, and marks the account there when Linear needs a new sign-in.
- Adopts an existing `mcp.servers.linear` at the URL for the chosen access unchanged, and reports any other `linear`
  server as a conflict.
- Default permission rules, inserted into every agent directly after its base allow rule: `linear_*` asks, and
  Linear's 42 read tools are allowed. Linear's 36 write tools, and tools Linear adds later, ask. Your `permissions`
  and saved "Always allow" answers override them, and Plan and Explore keep their restrictions.
- `/linear-status`, which reports the connection, account, access, tool counts with unknown tool names, agents
  without the default rules with the block to paste, the host check and the next step.
- The terminal UI dialog "Linear: Status", also `/linear`, with the same report through the read-only RPC method
  `linear.workspace/status`. `r` refreshes it and `Esc` closes it.
- The skills `linear` (always) and `linear-write` (with `access: "write"`).
- Options `access` (`"read"` or `"write"`, default `"read"`) and `allowUntestedHost` (default `false`).
- A host check that refuses OpenCode outside `>=2.2.3 <2.3.0` with `HOST_UNTESTED`, unless
  `allowUntestedHost` is set. Invalid options fail with `OPTIONS_INVALID`.
