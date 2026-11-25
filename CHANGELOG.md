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
- Two skills, `linear` and `linear-write`, read from the package's `skills/` folder at setup and registered with
  `ctx.skill.transform`. The contract's `register` does not load skills, so the plugin registers them itself; a broken
  file is a `status` problem, not a setup failure. Both skills are always registered, and the `access` rules decide
  what a change may do.
- Fresh documentation, `AGENTS.md`, and the two skills, with generated sections from the manifest and a conformance
  fixture for two synthetic aliases.

### Removed since v0.0.9

- The direct tools `linear_issues` and `linear_events_list`. The contract's method table gives the same reads as
  `issues` and `events_list` (`tools.linear.*` in Code Mode and the agent tools), so the two separate top-level tool
  ids are gone. Nothing is lost: the server, the reads and the assigned-issues snapshot are all still there.
- The `/linear-status` command, the `/linear` TUI dialog and the `linear.workspace` RPC (its `status` method). The
  contract's `status` method replaces the command and its RPC, and the bus emits `status` when the plugin is ready; a
  TUI part is outside the contract v0 surface, so the plugin ships no TUI.
- The `linear.workspace.tools` RPC for scripts. The contract registers one RPC id, `linear`, with every method under
  it, so a script calls `POST /api/rpc/linear/<method>`.
- The deprecated `read` and `write` access values. `access` is `all` (the default), `ask-changes` or `read-only`; the
  old values were aliases for `read-only` and `all`.
- The `/connect` entry's "Linear" label. The host names each alias's MCP server itself, so the entry shows `linear`, or
  `linear-<alias>` with more than one workspace; the sign-in itself is unchanged (`/connect`, or
  `opencode mcp auth linear-work` in a terminal).
