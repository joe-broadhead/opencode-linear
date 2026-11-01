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
| Tools | Linear's read tools only | Linear's read and write tools |
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

The plugin is tested on OpenCode `>=2.2.3 <2.3.0`. On any other version, including 2.3.0, prereleases and
development builds, it refuses to start:

```text
HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Install a plugin version made for your OpenCode, or set the plugin option allowUntestedHost: true to try anyway.
```

With `"allowUntestedHost": true`, it starts anyway, and `/linear-status` and `/linear` show a warning.

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
  { "action": "linear_whoami", "resource": "*", "effect": "allow" }
]
```

`READ_TOOLS` in `src/linear-tools.ts` lists Linear's 42 read tools, and `WRITE_TOOLS` its 36 write tools. Writes and
tools that Linear adds later match only `linear_*`, so they ask. `/linear-status` names the tools in neither list.

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
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Install a plugin version made for your OpenCode, or set `allowUntestedHost: true`. |
| `STATUS_UNAVAILABLE` | `/linear-status` or `/linear`: the status could not be read, or the plugin is not running on the server. | Restart OpenCode, or run `/plugins` to see why the plugin did not start. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `linear` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Linear tools may run without asking. Status shows the problem. | Restart OpenCode. |

For example:

```text
OPTIONS_INVALID: The option "access" must be "read" (the default) or "write", found "admin". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "write" } }].
```

Errors from Linear's server and from OpenCode pass through unchanged.
