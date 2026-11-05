# Architecture

The plugin is a thin layer over Linear's official MCP server. OpenCode owns the MCP transport, OAuth, credentials,
permission prompts and tool output limits. The plugin registers the server, names its `/connect` entry, adds default
permission rules, reports status, ships two skills, adds one read of its own, `linear_issues`, and lets scripts call
the known reads through a tools RPC. It has no runtime dependencies.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | The server part: the plugin `linear.workspace`, pointed at Linear's two servers |
| `src/plugin.ts` | Setup, and server registration or adoption |
| `src/integration.ts` | The `/connect` entry: its name "Linear", and the sign-in problem on its account |
| `src/options.ts` | Option parsing and validation |
| `src/host-version.ts` | The host check: the supported range, and the tested releases |
| `src/linear-tools.ts` | `READ_TOOLS`, `WRITE_TOOLS` and `classify()`. No runtime imports, so the drift script can load it |
| `src/permissions.ts` | The default rules, their placement, and detection of agents without them |
| `src/issues.ts` | `linear_issues`: the issues assigned to you as a table, read through the host's own `linear_list_issues` |
| `src/status.ts` | The status model and text, `/linear-status`, and the status RPC method |
| `src/skills.ts` | Loading and registering the skills |
| `src/host/tools-rpc.ts` | The tools RPC for scripts, `linear.workspace.tools`; a copy of a module shared by several plugins, with Linear's part in one marked block |
| `src/tui.ts` | The terminal UI part: the plugin `linear.workspace.tui` and the `/linear` dialog |
| `src/constants.ts` | IDs, the server name and URLs, the Code Mode namespace description, the supported host range, the tested releases (`TESTED_HOSTS`, the one list the checks and status use) and the error shape. Type-only imports, so `scripts/check.mjs` can load it |
| `src/version.ts` | The plugin's version from `package.json`; the build replaces it with the version string alone |

`scripts/build.mjs` bundles each entry with esbuild into one self-contained file: `src/index.ts` into `dist/index.js`
and `src/tui.ts` into `dist/tui.js`. Shared code, such as the status model and the RPC contract, is inlined into both.
The bundles have no chunks and no relative imports, because OpenCode reloads a plugin in place and keeps the modules it
already loaded for unchanged paths: an entry that imported a sibling module could get an older copy of it. Only
`@opencode/plugin`, OpenTUI, Solid and `node:` built-ins stay external, because the host provides them. `tsc` only
typechecks. The package exports `.` (`dist/index.js`) and `./tui` (`dist/tui.js`), and ships no declaration files.
`dist/index.js` finds the skills at `../skills/` from its own URL, which is the package root's `skills/`.

## Setup

1. `parseOptions` validates `access` and `allowUntestedHost`; anything else fails with `OPTIONS_INVALID`.
2. `checkHost` compares `ctx.app.version` with `>=2.2.3 <2.3.0`, the same range as `opencode.host` in `package.json`.
   Inside it the plugin starts, and status calls only 2.2.3, 2.2.4 and 2.2.5 tested. Outside it, setup fails with
   `HOST_UNTESTED` unless `allowUntestedHost` is set.
3. The skills are read from the package's `skills/` folder, before the synchronous skill transform needs them.
4. `ctx.mcp.transform` registers `linear` at the URL for `access`, or adopts the user's own entry at that URL. Any
   other URL is a conflict: nothing is added, and status reports it.
5. `ctx.tool.transform` gives the `linear` namespace its Code Mode description, which says what the access allows.
6. `ctx.agent.transform` inserts the default rules after each agent's base `* * allow`.
7. `ctx.tool.transform` adds `linear_issues`, a direct tool (`codemode: false`) in the `linear` namespace.
8. `ctx.skill.transform`, `ctx.command.transform` (`/linear-status`) and `ctx.rpc.register` (`linear.workspace/status`).
9. `registerToolsRpc` registers the tools RPC, `linear.workspace.tools`, and its `evaluate` hook.
10. `watchIntegration` starts. Setup returns one cleanup that stops it and disposes the tools RPC.

Transforms are synchronous and never throw: a failure is kept as a problem for status, and cleared when the next replay
succeeds.

## The `/connect` entry

OpenCode gives every remote MCP server with OAuth an integration, which `/connect` lists under MCP. The host registers
it after plugin setup, named after the server, and registers it again on every MCP reload, after the plugin's
transforms. So `watchIntegration` checks the server's integration on `integration.updated`, `mcp.status.changed` and
credential events, and polls for the first ten seconds. When the name is not "Linear", it registers a rename
transform again, which then runs after the host's, and disposes the old one.

While the server is `needs_auth` and the integration has an active account, it reports
`{ status: "needs_auth" }` on that account with `ctx.integration.connection.status`, so `/connect` shows that a new
sign-in is required. `connection.active` returns the credential alone, so the plugin reads the status back from
`integration.get`, which projects it, and clears only its own message once the server is connected again.

## Status

`readStatus` reads the server's state (`ctx.mcp.list()`), the account label (`ctx.integration.connection.active`),
the `linear` tools (`ctx.tool.list()`, by the namespace `linear`) and every agent's rules (`ctx.agent.list()`).
`buildStatus` turns them into one model, and `formatStatus` renders it in a fixed order: Connection (state and
server), Account, Access, Tools (counts and up to 20 unknown names), Agents without default rules (names, then the
default rules to paste, one rule a line), OpenCode (version, tested or not, the supported range, and setup problems), and exactly one
Next step, "Nothing to do." when nothing is needed. An agent is listed only when it lacks the rules and its own rules
would let a new Linear tool run without asking. OpenCode's text for a needed sign-in is never shown, and a failure's
reason is cut to one line of 160 characters with no URL query.

- `/linear-status` posts the text with `ctx.session.synthetic` (`resume: false`).
- The RPC method returns the model to the terminal UI and to scripts, with the fields every plugin of this family
  shares (`version`, `host`, `state`, `unguardedAgents`, `nextStep`). Its input and output are JSON Schemas that
  OpenCode validates. A status it cannot read is its declared error `unavailable`, with a next step. The UI part needs
  the RPC because on OpenCode 2.2.x it receives no plugin options and cannot see the server part's findings.

## Tools RPC

`linear.workspace.tools` lets a script call the known reads with no model; [Scripting](scripting.md) is the user's
view. Its methods are `describe` and one per name in `READ_TOOLS`, named after the upstream tool. It is an allowlist:
`WRITE_TOOLS`, and a tool that Linear adds later, which ask on the model path, are never methods. The methods are the
same with either access: the server is always named `linear`. `READ_TOOLS` is what Linear's read-only server lists;
`describe` reports each method as available or not from what OpenCode lists now.

A call is `{ sessionID, input }`. The module:

1. looks up the session with `ctx.session.get`, and its agent's rules with `ctx.agent.get` in the session's location
   (`SESSION_UNKNOWN`, `SESSION_AGENT_REQUIRED`);
2. refuses the tool when the last rule that matches `linear_<tool>` on `*`, in the agent's rules followed by the
   session's, is a deny: OpenCode hides such a tool from the model (`PERMISSION_DENIED`);
3. refuses with `SERVER_CONFLICT` while `linear` is a user server at another URL than the one for `access`; an adopted
   server is the plugin's;
4. finds the tool's executor in `ctx.tool.list()`, or names the server's connection state (`AUTH_REQUIRED` and so on)
   or `TOOL_UNAVAILABLE`;
5. calls `execute(input, { sessionID, agent, messageID, id, signal, progress })` with a new call id. OpenCode's
   executor checks `linear_<tool>` on `*` itself, with the agent's rules, the session's rules and saved approvals, and
   sends OpenCode's own credential;
6. returns `{ output?, text }`: the executor's output (the tool's structured content, or OpenCode's copy of its text
   when it has none) and the tool's text parts.

While a call runs, its id is live. A `permission.hook("evaluate")` turns an `ask` whose source id is live into a deny,
so the script gets `PERMISSION_DENIED` at once and no prompt waits. It changes nothing else; this is the plugin's only
permission hook, and the forbidden scan allows exactly this one.

A `Tool.Error` with a cause is a permission refusal; one without a cause is Linear's own error (`isError`), which
becomes `UPSTREAM_ERROR` with its first line, at most 300 characters, with tokens and URL queries removed. Any other
failure is OpenCode's own and passes through.

OpenCode decodes a plain JSON Schema input with Effect, which drops unknown keys of an object that has properties
instead of refusing them. So the envelope's schema carries a strict Standard Schema validator as a non-enumerable
`~standard` property, which OpenCode prefers. The contract still reads and serialises as plain JSON Schema, and
OpenCode answers a bad envelope with `rpc.invalid_input`.

The executor does not run `execute.before` and `execute.after` hooks. Linear has none, so results are unchanged.

## Terminal UI part

`src/tui.ts` uses no JSX, because OpenTUI's JSX transform skips `node_modules`. One global keymap layer provides
"Linear: Status" (palette and `/linear`) and the `r` key, which is enabled only while the dialog is open. The dialog
is a `ui.dialog.alert`, which closes on `Esc`. It listens to events only while it is open, and refreshes on `mcp.status.changed` for `linear`,
`server.connected`, `agent.updated`, `integration.updated`, `credential.updated` and `credential.switched`. The
newest answer wins, and a refresh never reopens a closed dialog.

## Platform facts

These facts about OpenCode 2.2.3 hold on 2.2.4 and 2.2.5 too. Links point to the source at tag `v2.2.3`.

| Topic | Fact | Source |
| --- | --- | --- |
| MCP tool permissions | The host asserts every MCP call: action `<server>_<tool>`, resource `*`. A last-matching `deny` on `*` hides the tool. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| Rule evaluation | The last match wins. Saved approvals come after all rules as `allow`. An unattended `ask` is refused. | [`permission.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/permission.ts) |
| Agent rule order | Built-in agents start from a base `* * allow` and exist before package plugins run. User `permissions`, and agents defined only in user config, come after. | [`config/plugin/agent.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/agent.ts) |
| User MCP config | `mcp.servers` is applied before package plugins. A later plugin `set` would replace the user's entry. | [`config/plugin/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/config/plugin/mcp.ts) |
| MCP integrations | Integration ID `mcp_` + the first 16 hex digits of sha1(`<name>\0<url>`), so credentials are kept per name and URL. | [`mcp/index.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/mcp/index.ts) |
| Credential status | A status set with `integration.connection.status` is not on what `connection.active` returns; `integration.get` projects it as `connections[].status`. A 401 whose token refresh fails with no refresh token leaves the credential in place, so the `/connect` mark is only observable then. The host test signs in through the loopback callback and the token endpoint, then challenges, and asserts the mark is set and cleared. | The host test, on 2.2.3, 2.2.4 and 2.2.5 |
| Code Mode | MCP tools are in Code Mode by default (`tools.linear.<tool>`). A declined prompt is an error the program can catch. | [`codemode/tool.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/codemode/tool.ts) |
| UI part options | The UI part of a plugin listed in `opencode.json` gets no plugin options. | Observed on stock 2.2.3, 2.2.4 and 2.2.5 |
| Tool executors | `ctx.tool.list()` returns each MCP tool with a callable `execute`, which checks `<server>_<tool>` with the agent's and the session's rules and saved approvals, and gives the `evaluate` hook the call's `source`. A deny is a `Tool.Error` with a cause; the server's `isError` is one without. `execute.before` and `execute.after` hooks do not run for it. Not documented as an entry point: the package test checks it on stock 2.2.3, 2.2.4 and 2.2.5. | [`tool/mcp.ts`](https://github.com/anomalyco/opencode/blob/v2.2.3/packages/core/src/tool/mcp.ts) |
| RPC input | An RPC input given as a Standard Schema is validated with it; a plain JSON Schema is decoded with Effect, which drops unknown keys of an object that has properties. The package test checks the envelope on stock 2.2.3, 2.2.4 and 2.2.5. | `@opencode/core` 2.2.3, the RPC service's `parse` |
