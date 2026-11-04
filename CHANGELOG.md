# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-11-04

### Added

- `linear_issues`, the plugin's own tool: the Linear issues assigned to you, in any state, as a table of identifier,
  title, state, priority and link (25 rows by default, at most 100). It reads them through Linear's `list_issues`,
  holds no credential, and runs without asking, through a new default rule
  `{ "action": "linear_issues", "resource": "*", "effect": "allow" }`. It is a direct tool, offered even when Code
  Mode holds Linear's other tools, so that Jelly can draw its result as a table. It is not a method of the tools RPC.
  Its errors are `AUTH_REQUIRED` and `UPSTREAM_UNREADABLE`, documented in the configuration guide.
- `/linear-status` and the status RPC count `linear_issues` among the Linear tools, never as an unknown one.
- A `jelly` section in `package.json` for [Jelly](https://github.com/joe-broadhead/opencode-linear/blob/HEAD/docs/jelly.md): the plugin's title, each of its 78 tools with its
  permission, default effect and whether it only reads, the skills, the sign-in, a table card for `linear_issues`, and
  a "My Linear issues" Home feed that refreshes every 15 minutes. Jelly reads it without loading the plugin.

## [0.0.2] - 2026-11-04

### Added

- OpenCode 2.2.5 is a tested release, next to 2.2.3 and 2.2.4.
- Code Mode's catalog now describes the `linear` namespace: what Linear's tools do, whether changes are available and
  ask first, and that Linear content is untrusted.
- The status RPC has `version`, the plugin's version, and `host.range`, the supported range.
- The status RPC declares the error `unavailable`. When status cannot be read, it answers
  `STATUS_UNAVAILABLE: Could not read Linear's status (…).` with a next step, instead of OpenCode's bare error, and the
  `/linear` dialog shows both.

### Changed

- The status RPC (`linear.workspace` `status`) uses the field names every plugin of this family shares. Scripts that
  read it need these changes:
  - `connection` is now `state`, with the shared states: `pending` is now `connecting`, `needs_sign_in` is now
    `sign_in_required`, and a `linear` server at another URL than your `access` uses is now `conflict`;
  - `agentsWithoutRules` is now `unguardedAgents`;
  - `host.warning` is gone, and the `OpenCode` row says why an untested host runs; `host.version` is `null` when
    OpenCode reports no version; `host.tested` is true only for 2.2.3, 2.2.4 and 2.2.5;
  - `unknownTools` holds at most 20 names, only those made of lowercase letters, digits and `_`, and the new
    `unknownCount` counts every unknown tool;
  - `error` is set only for a failed connection: OpenCode's reason on one line of at most 160 characters, with any URL
    cut before its query. Status no longer shows OpenCode's text for a needed sign-in, which can hold an
    authorization URL.
- On a release inside `>=2.2.3 <2.3.0` other than 2.2.3, 2.2.4 and 2.2.5, Linear starts as before, and status calls
  the version untested. The `OpenCode` row reads, for example, `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.
- `HOST_UNTESTED`'s next step is now `Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true
  to run anyway.`
- While agents lack the default rules, the next step says the whole fix: put the block first in each listed agent's
  own `permissions`, followed by your top-level rules for `linear_*` tools. Scripts reading only `nextStep` get it too.
- The tools RPC's `describe` accepts only `{}` or nothing, and otherwise answers `describe takes no input`. An envelope
  that is not an object gets one plain message, a refusal names the action that was refused, and a call during which
  Linear reconnects answers `CONNECTING` instead of `CONNECTION_FAILED`. `docs/scripting.md` lists the envelope
  messages.

### Fixed

- Linear's read-only server no longer lists `whoami`, but the plugin still counted it as one of 42 known reads: the
  tools RPC's `whoami` method always answered `TOOL_UNAVAILABLE`, and the `linear` skill told the model to call it.
  The known reads are now exactly the 41 tools that server lists, so `whoami` is no longer a method of the tools RPC
  or allowed by the default rules; if Linear serves it again, it asks before it runs. The skill and the docs use
  `get_user` with `query` `"me"` for the signed-in user, and `describe` shows which methods the server for your access
  lists now.
- The README's Uninstall steps failed: once the plugin was removed and OpenCode reloaded, `opencode mcp logout linear`
  answered "MCP server not found", and the sign-ins stayed in OpenCode's credential store, including the other
  access's, which that command never reaches. Uninstall now signs out first, of both accesses, checks with
  `opencode auth list`, then removes the plugin.
- The README now says what to do after `opencode plugin add` (run `opencode reload`, then `/linear-status`) and how to
  update the plugin.
- `docs/scripting.md` said `opencode api` runs in the directory you call it from. It runs in the OpenCode service's
  default location, your home directory; the doc now says how to target a project. It also says that `opencode api`
  exits with status 1 for an RPC error, and that a result with only text has that text as its `output`.

## [0.0.1] - 2026-11-03

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
