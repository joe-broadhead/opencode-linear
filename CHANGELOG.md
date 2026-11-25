# Changelog

## 0.0.0 (2026-11-25)

- The first release on plugin-contract v0: `Plugin.define`, `assertHost`, and one `register` call that wires the agent
  tools, Code Mode, RPC, the access rules and the bus.
- Accounts use the `mcp` mechanism: one Linear MCP server per alias (`linear`, `linear-work`, `linear-personal`), each
  with its own sign-in, and `account` on every method that reads Linear.
- 83 methods: `status`, `probe`, `events_list`, `issues`, Linear's 78 MCP tools declared one by one as
  `mcp:<tool>` with their class — 46 reads, 26 writes, 4 sends, 4 deletes and 2 shares — and one `mcp:*` write
  wildcard, emitted before them, so an undeclared or renamed Linear tool is denied at `read-only` and asked at
  `ask-changes` instead of reaching OpenCode's base allow-all.
- Two sources: `linear.activity` (issue changes and notifications, oldest first, with a `(timestamp, external_id)`
  cursor and a two-minute late-arrival lookback) and `linear.issues` (the assigned-issues `list` snapshot).
- Bus events `rpc.linear.status` and `rpc.linear.account`. A read emits nothing: the plugin owns no write, and the
  vendor's tools are the changes.
- Two skills, `linear` and `linear-write`, read from the package's `skills/` folder at setup and registered with
  `ctx.skill.transform`. The contract's `register` does not load skills, so the plugin reads and registers them itself.
  The frontmatter is parsed with the `yaml` package, which is bundled into `dist/index.js`; a malformed file throws
  `SCHEMA_VIOLATION` and fails setup instead of registering a marker. Both skills are always registered, and the
  `access` rules decide what a change may do. Each description is one quoted line; the tests compare the loader's
  `>`, `|`, `>-`, `|-`, `>+` and `|+` output with YAML, and the real-host test compares each registered description with
  the file.
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
