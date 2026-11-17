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
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Every tool
is declared `allow`, which changes nothing in Jelly: each tool follows the access choice and its
`readOnly`, by Jelly's shared rules below, and a read-only helper is denied every tool not marked `readOnly`.

- Ask: none declared. At Ask before changes, every tool not marked `readOnly` asks first.
- Off: none declared. At Read only, every tool not marked `readOnly` is off. A choice the person makes for one tool wins
  over both.
- `linear.events_list`, the plugin's own read for Memory's collector, which runs it unattended, is marked `readOnly`,
  so it runs at every access choice and never asks; the Linear reads it makes, `list_issues` and `get_notifications`,
  are marked `readOnly` too.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/unit/jelly.test.ts` checks
each declared effect against the plugin's own default rules. `test/unit/live-tools.test.ts` checks the declaration
against Linear's own tool list, captured live on 14 November 2026 in `test/fixtures/live-tools.json`
(`provenance.json` says how): every tool Linear serves is declared, every declared tool is served or is the plugin's
own (`test/fixtures/tool-registry.json`), and each `readOnly` is Linear's `readOnlyHint`.

Jelly's shared rules for every plugin of the family, word for word:

<!-- family-block:start -->
- At Allowed (`all`), the default, every tool runs without asking, declared or not, whatever its `effect`.
- At Ask before changes (`ask-changes`), a `readOnly` tool runs, and every other tool asks first, including a tool this plugin does not declare.
- At Read only (`read-only`), a `readOnly` tool runs, and every other tool is off, including a tool this plugin does not declare.
- A declared `effect` of `allow` changes nothing: the tool follows the access choice and its `readOnly`.
- A declared `effect` of `ask` makes the tool ask at Ask before changes, even when it is `readOnly`, and changes nothing at Allowed or Read only.
- A declared `effect` of `deny` turns the tool off at Ask before changes and at Read only, and changes nothing at Allowed.
- An action listed in `asks` asks first at Ask before changes and at Read only, and never at Allowed.
- A tool named with one `*`, such as another account's `plaud-*.get_file`, follows the same rules as a tool named in full.
- A choice the person makes for one tool wins over the access choice and the declared `effect`.
- jelly leaves out a key it does not know at the top level of the `jelly` block, and reads the rest.
- jelly refuses the plugin for a key it does not know inside anything it reads, such as a tool, a sign-in or a setting.
- jelly refuses the plugin, with one plain line, when `requires` names a field or a feature it does not read.
<!-- family-block:end -->

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

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit equal to the copy every plugin carries. The tools RPC and the events_list contract are not copies: they are the source contract's, pinned in `package-lock.json`.
