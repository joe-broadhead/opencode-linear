# Configuration

Every option is optional. The smallest setup is one entry in `plugins`:

```json
{
  "plugins": ["@joe-broadhead/opencode-linear"]
}
```

To set options, use the object form:

```json
{
  "plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "write" } }]
}
```

## Options

### `access`

- Type: `"read"` or `"write"`.
- Default: `"read"`.

| | `"read"` | `"write"` |
| --- | --- | --- |
| Server the plugin registers as `linear` | `https://mcp.linear.app/mcp/readonly` | `https://mcp.linear.app/mcp` |
| OAuth scope | `read` | `read write` |
| Tools | Linear's read tools only, and `linear_issues` | Linear's read and write tools, and `linear_issues` |
| Skills | `linear` | `linear` and `linear-write` |

Linear's read-only server lists only tools that read, and refuses changes itself. The default permission rules are the
same for both values; see [Permissions](#permissions).

OpenCode keeps sign-ins per server name and address, so read access and write access each have their own sign-in.
Linear's consent page decides the workspace of each one, so the two can be in different workspaces.

- Switching to an access you have never signed in with: run `/connect` and choose Linear, then press `o` or Enter to
  open the link. In a terminal, `opencode mcp auth linear` opens it automatically.
- Switching to an access you signed in with before: OpenCode reuses that sign-in without asking, in whatever
  workspace it was made. `/linear-status` shows the account.
- Changing the workspace of one access: with that access configured, run `opencode mcp logout linear` in the project
  where the plugin is configured. It removes every stored sign-in for the current `linear` address, and leaves the
  other access's sign-in alone. Or remove the account in `/connect` → Linear. Then sign in again and pick the
  workspace on Linear's consent page.

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4 and 2.2.5, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.6:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`.
- **Outside the range, including 2.3.0, prereleases and development builds:** the plugin refuses to start, and
  `/plugins` shows:

  ```text
  HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.
  ```

- **Outside the range with `"allowUntestedHost": true`:** it starts anyway, and `/linear-status` and `/linear` show a
  warning.

## Your own `mcp.servers.linear`

If your config defines no server named `linear`, the plugin registers one:

```json
{ "type": "remote", "url": "https://mcp.linear.app/mcp/readonly", "oauth": { "scope": "read" } }
```

With `access: "write"`, the URL is `https://mcp.linear.app/mcp` and the scope `read write`. OpenCode's own defaults
apply to everything else, and it registers its OAuth client with Linear automatically.

To change anything else, for example to use a pre-registered OAuth client, define `mcp.servers.linear` yourself, at
the URL for your `access`. The plugin then **adopts** your entry unchanged, and `/linear-status` shows "Connection:
connected (…, your own mcp.servers.linear, used unchanged)". The permission rules and skills still follow `access`.

```json
{
  "mcp": {
    "servers": {
      "linear": {
        "type": "remote",
        "url": "https://mcp.linear.app/mcp/readonly",
        "oauth": { "client_id": "<your client ID>", "scope": "read" }
      }
    }
  }
}
```

The plugin compares origin and path, so a trailing slash or a query string still matches. Any other URL, including
Linear's other server, or a local command, is a **conflict**: the plugin leaves your entry alone, adds nothing, status
shows "Connection: conflict", and gives the next step:

```text
- Next step: Your OpenCode config defines mcp.servers.linear with https://mcp.linear.app/mcp, but access "read" uses https://mcp.linear.app/mcp/readonly. Point it at https://mcp.linear.app/mcp/readonly or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `linear_<tool>` and the resource `*`. The plugin adds these
rules to every agent that starts with the base rule `{ "action": "*", "resource": "*", "effect": "allow" }`, directly
after that rule:

```json
[
  { "action": "linear_*", "resource": "*", "effect": "ask" },
  { "action": "linear_extract_images", "resource": "*", "effect": "allow" },
  { "action": "linear_get_agent_skill", "resource": "*", "effect": "allow" },
  "… one allow rule for each read tool in src/linear-tools.ts …",
  { "action": "linear_search_documentation", "resource": "*", "effect": "allow" },
  { "action": "linear_issues", "resource": "*", "effect": "allow" }
]
```

`READ_TOOLS` in `src/linear-tools.ts` lists Linear's 41 read tools, the tools its read-only server lists, and
`WRITE_TOOLS` its 36 write tools. Writes and tools that Linear adds later match only `linear_*`, so they ask.
`/linear-status` names the tools in neither list.

The last rule is for the plugin's own tool, `linear_issues`: the issues assigned to you, as a table of identifier,
title, state, priority and link (25 rows by default, at most 100). It only reads, through Linear's `list_issues` with
assignee `me`, so `list_issues`'s own rules apply to that call as well, and the plugin holds no credential. It is a
direct tool, set with `codemode: false`: the model is offered it directly even when Code Mode holds Linear's other
tools, because [Jelly](jelly.md) draws its result as a table only for a direct call. `/linear-status` counts it among
the Linear tools, never as an unknown one. It is not a method of the tools RPC; a script calls `list_issues` itself.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Plan's and Explore's restrictions;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved "Always allow" answers, which beat an `ask` but never a configured `deny`.

A `deny` on resource `*` also hides the tool from the model. In an unattended run such as `opencode run`, a tool that
asks is refused. An agent without the base rule gets no Linear rules and keeps its own behaviour.

### Recipes

Put these in the top-level `permissions` of `opencode.json`. They apply to every agent. To limit a rule to one
agent, put it in that agent's own `permissions` instead.

Never delete anything in Linear (a `deny` also hides the matching tools):

```json
{ "action": "linear_delete_*", "resource": "*", "effect": "deny" }
```

Run one write tool without a prompt (or answer "Always allow" once):

```json
{ "action": "linear_save_comment", "resource": "*", "effect": "allow" }
```

### Agents that miss the rules

OpenCode creates agents that exist only in your config after plugins add their rules, so those agents get no Linear
rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the `linear_*` ask
rule appears anywhere after its base allow. `/linear-status` and `/linear` list every other agent where a new Linear
tool would run without asking, followed by the block to paste.

Put the block first in that agent's own `permissions`, then repeat after it any top-level rules you have for
`linear_*` tools, so yours keep winning. Never put the block in the top-level `permissions`: top-level rules come
after every agent's own rules, so it would loosen Explore. For an agent `reviewer`, with one top-level rule of your
own:

```json
{
  "permissions": [{ "action": "linear_delete_*", "resource": "*", "effect": "deny" }],
  "agents": {
    "reviewer": {
      "description": "Reviews changes",
      "mode": "subagent",
      "permissions": [
        { "action": "linear_*", "resource": "*", "effect": "ask" },
        { "action": "linear_extract_images", "resource": "*", "effect": "allow" },
        "… the rest of the block from /linear-status …",
        { "action": "linear_delete_*", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/linear-status` output; the lines in quotes above stand for it.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/linear-status`, `/linear` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | Restart OpenCode, or run `/plugins` to see why the plugin did not start. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `linear` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Linear tools may run without asking. Status shows the problem. | Restart OpenCode. |
| `AUTH_REQUIRED` | `linear_issues`: OpenCode does not list Linear's `list_issues`, usually because the `linear` server needs a sign-in. | Run `/connect` and choose Linear to sign in, or run `/linear-status` if you are signed in already. |
| `UPSTREAM_UNREADABLE` | `linear_issues`: Linear's `list_issues` answered with something other than a list of issues. | Ask for `list_issues` with assignee `me` instead, which shows Linear's answer as it is, and update the plugin. |

For example:

```text
OPTIONS_INVALID: The option "access" must be "read" (the default) or "write", found "admin". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "write" } }].
```

Errors from Linear's server and from OpenCode pass through unchanged, except in the tools RPC for scripts, whose codes
are in [Scripting](scripting.md#errors).

## Status and RPC

`/linear-status`, the `/linear` dialog and the RPC method `status` (RPC ID `linear.workspace`) share one status model.
It holds no token and no URL query. `version`, `host`, `state`, `unguardedAgents` and `nextStep` are the fields every
plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The `Connection` row shows the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `error` | For a failed connection only: OpenCode's reason, on one line of at most 160 characters, with any URL cut before its query. The text for a needed sign-in can hold an authorization URL, so it is never shown. |
| `account` | The account label OpenCode reports, if any |
| `access` | `read` or `write` |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, and for a conflict the `expected` URL |
| `tools` | How many Linear tools OpenCode lists |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new Linear tool would run without asking; empty when there are none. An agent whose own rules already ask or deny for every Linear tool is not listed. |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4 and 2.2.5) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Linear's status (…).` and `data: { nextStep }`.
