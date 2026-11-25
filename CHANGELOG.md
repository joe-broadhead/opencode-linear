# Changelog

## 0.0.0 (2026-11-25)

- The first release on plugin-contract v0: `Plugin.define`, `assertHost`, and one `register` call that wires the agent
  tools, Code Mode, RPC, the access rules and the bus.
- Accounts use the `mcp` mechanism: one Linear MCP server per alias (`linear`, `linear-work`, `linear-personal`), each
  with its own sign-in, and `account` on every method that reads Linear.
- 82 methods: `status`, `probe`, `events_list`, `issues`, and Linear's 78 MCP tools declared one by one as
  `mcp:<tool>` with their class — 46 reads, 26 writes, 4 sends, 4 deletes and 2 shares.
- Two sources: `linear.activity` (issue changes and notifications, oldest first, with a `(timestamp, external_id)`
  cursor and a two-minute late-arrival lookback) and `linear.issues` (the assigned-issues `list` snapshot).
- Bus events `rpc.linear.changed`, `rpc.linear.status` and `rpc.linear.account`.
- Fresh documentation, `AGENTS.md`, and the `linear` and `linear-write` skills, with generated sections from the
  manifest and a conformance fixture for two synthetic aliases.
