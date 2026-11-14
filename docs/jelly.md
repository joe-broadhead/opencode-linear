# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Linear** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. A Jelly whose declaration schema lacks `summary` or `icon` refuses this
declaration, because that schema accepts no unknown keys.

## Tools and permissions

80 tools are declared (43 read-only): Linear's 41 reads and its 37 other tools, and the plugin's own
`linear_issues` and `linear_events_list`. Each `readOnly` is Linear's own `readOnlyHint`. `linear.whoami` only reports
the signed-in user and workspace, but Linear marks it `readOnlyHint: false`, so it is declared not read-only: a
read-only helper is not given it, and at `read-only` it is denied. `linear.get_user` with `me` reads the same account
and is read-only. Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: none. Every tool is declared `allow`, so a Jelly agent runs what the plugin's own default allows.
- Off: none. To make one ask or stop, declare `ask` or `deny` for it, or set the plugin's `access` option in the agent's options.
- Everything else runs, as the plugin's own rules let it. `linear.events_list` is for Memory's collector, which runs
  it unattended, so it never asks; each Linear read it makes follows that read's own effect.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/unit/jelly.test.ts` checks
each declared effect against the plugin's own default rules. `test/unit/live-tools.test.ts` checks the declaration
against Linear's own tool list, captured live on 14 November 2026 in `test/fixtures/live-tools.json`
(`provenance.json` says how): every tool Linear serves is declared, every declared tool is served or is the plugin's
own (`test/fixtures/tool-registry.json`), and each `readOnly` is Linear's `readOnlyHint`.

## Skills

Declared: `linear`, `linear-write`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views

- **Linear issues**, Jelly's native `table` card, behind `linear_issues`: the plugin's own read,
  which calls Linear's `list_issues` (assignee `me`) through the host and answers in the table's
  shape. It is a direct tool, so Jelly sees its result: Jelly does not see the result of a call made inside
  Code Mode.
- **My Linear issues**, a Home feed preset that calls `linear.issues` every 15 minutes and lists your assigned
  issues in any state, each as `ENG-1: Title`.

## Signing in

`jelly.signIns` declares one sign-in, `linear`, for Linear's MCP server `linear`, which signs in with OpenCode's MCP OAuth. The plugin uses one server, `https://mcp.linear.app/mcp` with `read write`, for every `access` value, so changing the setting in Jelly keeps the sign-in: the setting is a policy, and the generated rules and Jelly's own access rules do the gating. At **Read only** the sign-in can still write; the rules deny every change.

The sign-in declares `relay: {}`: when the browser cannot reach the engine's loopback, Linear's sign-in may come back through Jelly's relay. This is declared but not yet checked with Linear: Linear's documentation does not describe client metadata documents or its redirect rules, and the only evidence is its server's own metadata, which advertises dynamic client registration and `client_id_metadata_document_supported`. No sign-in through the relay has been made yet.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, and the shared part of the tools RPC (`src/host/tools-rpc.ts`), equal to the copy every plugin carries.
