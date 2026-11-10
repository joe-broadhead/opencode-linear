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
  "plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "ask-changes" } }]
}
```

## Options

### `access`

- Type: `"all"`, `"ask-changes"` or `"read-only"`.
- Default: `"all"`.

| | `"all"` (the default) | `"ask-changes"` | `"read-only"` |
| --- | --- | --- | --- |
| Server the plugin registers as `linear` | `https://mcp.linear.app/mcp` | `https://mcp.linear.app/mcp` | `https://mcp.linear.app/mcp/readonly` |
| OAuth scope | `read write` | `read write` | `read` |
| Default rules | every tool allows, and so does the `linear_*` pattern | reads allow; every other tool asks | reads allow; every other tool is denied |
| Tools | Linear's read and write tools, and `linear_issues` | Linear's read and write tools, and `linear_issues` | Linear's read tools only, and `linear_issues` |
| Skills | `linear` and `linear-write` | `linear` and `linear-write` | `linear` |

Linear's read-only server lists only tools that read, and refuses changes itself. The generated rules for each value
are printed in full under [Permissions](#permissions).

`"read"` and `"write"` are the values the option accepted before this one: `"read"` means `"read-only"` and `"write"`
means `"all"`, and `/linear-status` says so in the Access row. Set the new value, and sign in again if the server
address changed.

OpenCode keeps sign-ins per server name and address, so the read-only server and the full one each have their own
sign-in. Linear's consent page decides the workspace of each one, so the two can be in different workspaces.

- Switching to a server you have never signed in with: run `/connect` and choose Linear, then press `o` or Enter to
  open the link. In a terminal, `opencode mcp auth linear` opens it automatically.
- Switching to a server you signed in with before: OpenCode reuses that sign-in without asking, in whatever
  workspace it was made. Ask the model which Linear workspace it is connected to; Linear's `get_workspace` answers.
- Changing the workspace of one server: with that access configured, run `opencode mcp logout linear` in the project
  where the plugin is configured. It removes every stored sign-in for the current `linear` address, and leaves the
  other server's sign-in alone. Or remove the account in `/connect` → Linear. Then sign in again and pick the
  workspace on Linear's consent page.

### `allowUntestedHost`

- Type: `true` or `false`.
- Default: `false`.

The plugin supports OpenCode `>=2.2.3 <2.3.0`, the range `opencode.host` in `package.json` declares, and every check
runs on 2.2.3, 2.2.4, 2.2.5 and 2.2.6, the tested releases. Status shows the version, whether it is tested and the supported
range in its `OpenCode` row, for example `2.2.5 (tested; supported range >=2.2.3 <2.3.0)`.

- **A tested release:** the plugin starts.
- **Another release inside the range, such as 2.2.99:** the plugin starts too. Status marks the version `untested`, and
  the status RPC's `host.tested` is `false`. The next step is the same as on a tested release.
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
{ "type": "remote", "url": "https://mcp.linear.app/mcp", "oauth": { "scope": "read write" } }
```

With `access: "read-only"`, the URL is `https://mcp.linear.app/mcp/readonly` and the scope `read`. OpenCode's own
defaults apply to everything else, and it registers its OAuth client with Linear automatically.

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
- Next step: Your OpenCode config defines mcp.servers.linear with https://mcp.linear.app/mcp/readonly, but access "all" uses https://mcp.linear.app/mcp. Point it at https://mcp.linear.app/mcp or remove it, then restart OpenCode.
```

## Permissions

OpenCode asserts every MCP call itself, with the action `linear_<tool>` and the resource `*`. **Every tool is allowed by
default.** The plugin adds the rules for the `access` option to every agent that starts with the base rule
`{ "action": "*", "resource": "*", "effect": "allow" }`, directly after that rule. The block is generated from
`defaultRules(access)` in `src/permissions.ts`, and each value's block is printed below in full.

`access: "all"` (the default) allows every tool the plugin registers, and any tool Linear adds later:

```json
[
  {"action":"linear_*","resource":"*","effect":"allow"},
  {"action":"linear_extract_images","resource":"*","effect":"allow"},
  {"action":"linear_get_agent_skill","resource":"*","effect":"allow"},
  {"action":"linear_get_attachment","resource":"*","effect":"allow"},
  {"action":"linear_get_diff","resource":"*","effect":"allow"},
  {"action":"linear_get_diff_threads","resource":"*","effect":"allow"},
  {"action":"linear_get_document","resource":"*","effect":"allow"},
  {"action":"linear_get_initiative","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"},
  {"action":"linear_get_issue_status","resource":"*","effect":"allow"},
  {"action":"linear_get_milestone","resource":"*","effect":"allow"},
  {"action":"linear_get_notifications","resource":"*","effect":"allow"},
  {"action":"linear_get_project","resource":"*","effect":"allow"},
  {"action":"linear_get_release","resource":"*","effect":"allow"},
  {"action":"linear_get_release_note","resource":"*","effect":"allow"},
  {"action":"linear_get_status_updates","resource":"*","effect":"allow"},
  {"action":"linear_get_team","resource":"*","effect":"allow"},
  {"action":"linear_get_template","resource":"*","effect":"allow"},
  {"action":"linear_get_triage_responsibility","resource":"*","effect":"allow"},
  {"action":"linear_get_user","resource":"*","effect":"allow"},
  {"action":"linear_get_workspace","resource":"*","effect":"allow"},
  {"action":"linear_list_agent_skills","resource":"*","effect":"allow"},
  {"action":"linear_list_comments","resource":"*","effect":"allow"},
  {"action":"linear_list_custom_views","resource":"*","effect":"allow"},
  {"action":"linear_list_cycles","resource":"*","effect":"allow"},
  {"action":"linear_list_diffs","resource":"*","effect":"allow"},
  {"action":"linear_list_documents","resource":"*","effect":"allow"},
  {"action":"linear_list_initiative_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_initiatives","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_statuses","resource":"*","effect":"allow"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_list_milestones","resource":"*","effect":"allow"},
  {"action":"linear_list_project_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_projects","resource":"*","effect":"allow"},
  {"action":"linear_list_release_notes","resource":"*","effect":"allow"},
  {"action":"linear_list_release_pipelines","resource":"*","effect":"allow"},
  {"action":"linear_list_releases","resource":"*","effect":"allow"},
  {"action":"linear_list_teams","resource":"*","effect":"allow"},
  {"action":"linear_list_templates","resource":"*","effect":"allow"},
  {"action":"linear_list_users","resource":"*","effect":"allow"},
  {"action":"linear_search_documentation","resource":"*","effect":"allow"},
  {"action":"linear_issues","resource":"*","effect":"allow"},
  {"action":"linear_events_list","resource":"*","effect":"allow"},
  {"action":"linear_create_attachment","resource":"*","effect":"allow"},
  {"action":"linear_create_attachment_from_upload","resource":"*","effect":"allow"},
  {"action":"linear_create_initiative_label","resource":"*","effect":"allow"},
  {"action":"linear_create_issue_label","resource":"*","effect":"allow"},
  {"action":"linear_delete_attachment","resource":"*","effect":"allow"},
  {"action":"linear_delete_comment","resource":"*","effect":"allow"},
  {"action":"linear_delete_diff_comment","resource":"*","effect":"allow"},
  {"action":"linear_delete_status_update","resource":"*","effect":"allow"},
  {"action":"linear_mark_notification","resource":"*","effect":"allow"},
  {"action":"linear_merge_diff","resource":"*","effect":"allow"},
  {"action":"linear_prepare_attachment_upload","resource":"*","effect":"allow"},
  {"action":"linear_prepare_file_upload","resource":"*","effect":"allow"},
  {"action":"linear_resolve_diff_thread","resource":"*","effect":"allow"},
  {"action":"linear_restore_initiative_label","resource":"*","effect":"allow"},
  {"action":"linear_restore_issue_label","resource":"*","effect":"allow"},
  {"action":"linear_restore_project_label","resource":"*","effect":"allow"},
  {"action":"linear_retire_initiative_label","resource":"*","effect":"allow"},
  {"action":"linear_retire_issue_label","resource":"*","effect":"allow"},
  {"action":"linear_retire_project_label","resource":"*","effect":"allow"},
  {"action":"linear_save_comment","resource":"*","effect":"allow"},
  {"action":"linear_save_diff_comment","resource":"*","effect":"allow"},
  {"action":"linear_save_document","resource":"*","effect":"allow"},
  {"action":"linear_save_initiative","resource":"*","effect":"allow"},
  {"action":"linear_save_initiative_label","resource":"*","effect":"allow"},
  {"action":"linear_save_issue","resource":"*","effect":"allow"},
  {"action":"linear_save_issue_label","resource":"*","effect":"allow"},
  {"action":"linear_save_milestone","resource":"*","effect":"allow"},
  {"action":"linear_save_project","resource":"*","effect":"allow"},
  {"action":"linear_save_project_label","resource":"*","effect":"allow"},
  {"action":"linear_save_release","resource":"*","effect":"allow"},
  {"action":"linear_save_release_note","resource":"*","effect":"allow"},
  {"action":"linear_save_status_update","resource":"*","effect":"allow"},
  {"action":"linear_share_issue","resource":"*","effect":"allow"},
  {"action":"linear_submit_diff_review","resource":"*","effect":"allow"},
  {"action":"linear_unshare_issue","resource":"*","effect":"allow"},
  {"action":"linear_update_diff","resource":"*","effect":"allow"}
]
```

`access: "ask-changes"` allows the reads and asks for every write, and for a tool Linear adds later:

```json
[
  {"action":"linear_*","resource":"*","effect":"ask"},
  {"action":"linear_extract_images","resource":"*","effect":"allow"},
  {"action":"linear_get_agent_skill","resource":"*","effect":"allow"},
  {"action":"linear_get_attachment","resource":"*","effect":"allow"},
  {"action":"linear_get_diff","resource":"*","effect":"allow"},
  {"action":"linear_get_diff_threads","resource":"*","effect":"allow"},
  {"action":"linear_get_document","resource":"*","effect":"allow"},
  {"action":"linear_get_initiative","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"},
  {"action":"linear_get_issue_status","resource":"*","effect":"allow"},
  {"action":"linear_get_milestone","resource":"*","effect":"allow"},
  {"action":"linear_get_notifications","resource":"*","effect":"allow"},
  {"action":"linear_get_project","resource":"*","effect":"allow"},
  {"action":"linear_get_release","resource":"*","effect":"allow"},
  {"action":"linear_get_release_note","resource":"*","effect":"allow"},
  {"action":"linear_get_status_updates","resource":"*","effect":"allow"},
  {"action":"linear_get_team","resource":"*","effect":"allow"},
  {"action":"linear_get_template","resource":"*","effect":"allow"},
  {"action":"linear_get_triage_responsibility","resource":"*","effect":"allow"},
  {"action":"linear_get_user","resource":"*","effect":"allow"},
  {"action":"linear_get_workspace","resource":"*","effect":"allow"},
  {"action":"linear_list_agent_skills","resource":"*","effect":"allow"},
  {"action":"linear_list_comments","resource":"*","effect":"allow"},
  {"action":"linear_list_custom_views","resource":"*","effect":"allow"},
  {"action":"linear_list_cycles","resource":"*","effect":"allow"},
  {"action":"linear_list_diffs","resource":"*","effect":"allow"},
  {"action":"linear_list_documents","resource":"*","effect":"allow"},
  {"action":"linear_list_initiative_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_initiatives","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_statuses","resource":"*","effect":"allow"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_list_milestones","resource":"*","effect":"allow"},
  {"action":"linear_list_project_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_projects","resource":"*","effect":"allow"},
  {"action":"linear_list_release_notes","resource":"*","effect":"allow"},
  {"action":"linear_list_release_pipelines","resource":"*","effect":"allow"},
  {"action":"linear_list_releases","resource":"*","effect":"allow"},
  {"action":"linear_list_teams","resource":"*","effect":"allow"},
  {"action":"linear_list_templates","resource":"*","effect":"allow"},
  {"action":"linear_list_users","resource":"*","effect":"allow"},
  {"action":"linear_search_documentation","resource":"*","effect":"allow"},
  {"action":"linear_issues","resource":"*","effect":"allow"},
  {"action":"linear_events_list","resource":"*","effect":"allow"},
  {"action":"linear_create_attachment","resource":"*","effect":"ask"},
  {"action":"linear_create_attachment_from_upload","resource":"*","effect":"ask"},
  {"action":"linear_create_initiative_label","resource":"*","effect":"ask"},
  {"action":"linear_create_issue_label","resource":"*","effect":"ask"},
  {"action":"linear_delete_attachment","resource":"*","effect":"ask"},
  {"action":"linear_delete_comment","resource":"*","effect":"ask"},
  {"action":"linear_delete_diff_comment","resource":"*","effect":"ask"},
  {"action":"linear_delete_status_update","resource":"*","effect":"ask"},
  {"action":"linear_mark_notification","resource":"*","effect":"ask"},
  {"action":"linear_merge_diff","resource":"*","effect":"ask"},
  {"action":"linear_prepare_attachment_upload","resource":"*","effect":"ask"},
  {"action":"linear_prepare_file_upload","resource":"*","effect":"ask"},
  {"action":"linear_resolve_diff_thread","resource":"*","effect":"ask"},
  {"action":"linear_restore_initiative_label","resource":"*","effect":"ask"},
  {"action":"linear_restore_issue_label","resource":"*","effect":"ask"},
  {"action":"linear_restore_project_label","resource":"*","effect":"ask"},
  {"action":"linear_retire_initiative_label","resource":"*","effect":"ask"},
  {"action":"linear_retire_issue_label","resource":"*","effect":"ask"},
  {"action":"linear_retire_project_label","resource":"*","effect":"ask"},
  {"action":"linear_save_comment","resource":"*","effect":"ask"},
  {"action":"linear_save_diff_comment","resource":"*","effect":"ask"},
  {"action":"linear_save_document","resource":"*","effect":"ask"},
  {"action":"linear_save_initiative","resource":"*","effect":"ask"},
  {"action":"linear_save_initiative_label","resource":"*","effect":"ask"},
  {"action":"linear_save_issue","resource":"*","effect":"ask"},
  {"action":"linear_save_issue_label","resource":"*","effect":"ask"},
  {"action":"linear_save_milestone","resource":"*","effect":"ask"},
  {"action":"linear_save_project","resource":"*","effect":"ask"},
  {"action":"linear_save_project_label","resource":"*","effect":"ask"},
  {"action":"linear_save_release","resource":"*","effect":"ask"},
  {"action":"linear_save_release_note","resource":"*","effect":"ask"},
  {"action":"linear_save_status_update","resource":"*","effect":"ask"},
  {"action":"linear_share_issue","resource":"*","effect":"ask"},
  {"action":"linear_submit_diff_review","resource":"*","effect":"ask"},
  {"action":"linear_unshare_issue","resource":"*","effect":"ask"},
  {"action":"linear_update_diff","resource":"*","effect":"ask"}
]
```

`access: "read-only"` allows the reads and denies every write, and a tool Linear adds later. It also registers
Linear's read-only server, so its write tools are not listed at all:

```json
[
  {"action":"linear_*","resource":"*","effect":"deny"},
  {"action":"linear_extract_images","resource":"*","effect":"allow"},
  {"action":"linear_get_agent_skill","resource":"*","effect":"allow"},
  {"action":"linear_get_attachment","resource":"*","effect":"allow"},
  {"action":"linear_get_diff","resource":"*","effect":"allow"},
  {"action":"linear_get_diff_threads","resource":"*","effect":"allow"},
  {"action":"linear_get_document","resource":"*","effect":"allow"},
  {"action":"linear_get_initiative","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"},
  {"action":"linear_get_issue_status","resource":"*","effect":"allow"},
  {"action":"linear_get_milestone","resource":"*","effect":"allow"},
  {"action":"linear_get_notifications","resource":"*","effect":"allow"},
  {"action":"linear_get_project","resource":"*","effect":"allow"},
  {"action":"linear_get_release","resource":"*","effect":"allow"},
  {"action":"linear_get_release_note","resource":"*","effect":"allow"},
  {"action":"linear_get_status_updates","resource":"*","effect":"allow"},
  {"action":"linear_get_team","resource":"*","effect":"allow"},
  {"action":"linear_get_template","resource":"*","effect":"allow"},
  {"action":"linear_get_triage_responsibility","resource":"*","effect":"allow"},
  {"action":"linear_get_user","resource":"*","effect":"allow"},
  {"action":"linear_get_workspace","resource":"*","effect":"allow"},
  {"action":"linear_list_agent_skills","resource":"*","effect":"allow"},
  {"action":"linear_list_comments","resource":"*","effect":"allow"},
  {"action":"linear_list_custom_views","resource":"*","effect":"allow"},
  {"action":"linear_list_cycles","resource":"*","effect":"allow"},
  {"action":"linear_list_diffs","resource":"*","effect":"allow"},
  {"action":"linear_list_documents","resource":"*","effect":"allow"},
  {"action":"linear_list_initiative_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_initiatives","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_issue_statuses","resource":"*","effect":"allow"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_list_milestones","resource":"*","effect":"allow"},
  {"action":"linear_list_project_labels","resource":"*","effect":"allow"},
  {"action":"linear_list_projects","resource":"*","effect":"allow"},
  {"action":"linear_list_release_notes","resource":"*","effect":"allow"},
  {"action":"linear_list_release_pipelines","resource":"*","effect":"allow"},
  {"action":"linear_list_releases","resource":"*","effect":"allow"},
  {"action":"linear_list_teams","resource":"*","effect":"allow"},
  {"action":"linear_list_templates","resource":"*","effect":"allow"},
  {"action":"linear_list_users","resource":"*","effect":"allow"},
  {"action":"linear_search_documentation","resource":"*","effect":"allow"},
  {"action":"linear_issues","resource":"*","effect":"allow"},
  {"action":"linear_events_list","resource":"*","effect":"allow"},
  {"action":"linear_create_attachment","resource":"*","effect":"deny"},
  {"action":"linear_create_attachment_from_upload","resource":"*","effect":"deny"},
  {"action":"linear_create_initiative_label","resource":"*","effect":"deny"},
  {"action":"linear_create_issue_label","resource":"*","effect":"deny"},
  {"action":"linear_delete_attachment","resource":"*","effect":"deny"},
  {"action":"linear_delete_comment","resource":"*","effect":"deny"},
  {"action":"linear_delete_diff_comment","resource":"*","effect":"deny"},
  {"action":"linear_delete_status_update","resource":"*","effect":"deny"},
  {"action":"linear_mark_notification","resource":"*","effect":"deny"},
  {"action":"linear_merge_diff","resource":"*","effect":"deny"},
  {"action":"linear_prepare_attachment_upload","resource":"*","effect":"deny"},
  {"action":"linear_prepare_file_upload","resource":"*","effect":"deny"},
  {"action":"linear_resolve_diff_thread","resource":"*","effect":"deny"},
  {"action":"linear_restore_initiative_label","resource":"*","effect":"deny"},
  {"action":"linear_restore_issue_label","resource":"*","effect":"deny"},
  {"action":"linear_restore_project_label","resource":"*","effect":"deny"},
  {"action":"linear_retire_initiative_label","resource":"*","effect":"deny"},
  {"action":"linear_retire_issue_label","resource":"*","effect":"deny"},
  {"action":"linear_retire_project_label","resource":"*","effect":"deny"},
  {"action":"linear_save_comment","resource":"*","effect":"deny"},
  {"action":"linear_save_diff_comment","resource":"*","effect":"deny"},
  {"action":"linear_save_document","resource":"*","effect":"deny"},
  {"action":"linear_save_initiative","resource":"*","effect":"deny"},
  {"action":"linear_save_initiative_label","resource":"*","effect":"deny"},
  {"action":"linear_save_issue","resource":"*","effect":"deny"},
  {"action":"linear_save_issue_label","resource":"*","effect":"deny"},
  {"action":"linear_save_milestone","resource":"*","effect":"deny"},
  {"action":"linear_save_project","resource":"*","effect":"deny"},
  {"action":"linear_save_project_label","resource":"*","effect":"deny"},
  {"action":"linear_save_release","resource":"*","effect":"deny"},
  {"action":"linear_save_release_note","resource":"*","effect":"deny"},
  {"action":"linear_save_status_update","resource":"*","effect":"deny"},
  {"action":"linear_share_issue","resource":"*","effect":"deny"},
  {"action":"linear_submit_diff_review","resource":"*","effect":"deny"},
  {"action":"linear_unshare_issue","resource":"*","effect":"deny"},
  {"action":"linear_update_diff","resource":"*","effect":"deny"}
]
```

`linear_issues` is the plugin's own read tool, allowed by
`{ "action": "linear_issues", "resource": "*", "effect": "allow" }`: it runs the host's `list_issues`, so that tool's
rules apply to the call it makes. It is a direct tool, so Jelly can draw its result as a table. The `linear_*` pattern also matches tools of any other MCP server whose name starts
with `linear_`; those follow the same access value.

The last rule is for the plugin's other tool, `linear_events_list`, Memory's source of Linear events ([Events
list](#events-list)). It only reads, and Memory's collector runs it with no one there, so it must not ask.
`/linear-status` counts it among the Linear tools, never as an unknown one.

OpenCode uses the last rule that matches, so everything after the plugin's rules wins:

1. the agent's own rules, such as Explore's restrictions and Plan's;
2. your top-level `permissions`, which OpenCode adds to every agent;
3. your saved **Always allow** answers, which beat an `ask` but never a configured `deny`.

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
rules; agents that a later plugin adds are in the same position. An agent counts as guarded when the whole default
block for the configured `access` appears, in order, anywhere after its base allow; its own rules decide otherwise. `/linear-status` and `/linear` list every other agent where a new Linear
tool would run without asking, by name, followed by the default rules to paste. The next step reads:

```text
Put the default rules shown by /linear-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Linear tools.
```

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
        { "action": "linear_delete_comment", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Copy the full block from your own `/linear-status` output; the lines in quotes above stand for it.

## Events list

`linear_events_list` (Code Mode `tools.linear.events_list`, and the tools RPC method `events_list`) is this plugin's
side of the `events_list` source contract that Memory's collector reads. It is not for answering questions: the model
uses `list_issues` or `linear_issues` for that.

```text
events_list({ since?, cursor?, limit?, account?, source? })
  → { source: "linear", account, owner: { id, label }, events, cursor, more, trust: "untrusted" }
```

- **What it lists**, oldest first: each change to an issue assigned to you (`list_issues` with assignee `me`, ordered
  and filtered by `updatedAt`), one event per issue and update time; and each notification in your Linear inbox
  (`get_notifications`, read newest first until the cursor's last notification). Issues assigned to others are left
  out, except through your notifications.
- **An issue event**: kind `issue`, `external_id` `<identifier>@<update time>`, thread `linear-issue:<issue id>`,
  actors `linear:<user id>` (assignee, creator), title `<identifier>: <title>`, text the status, priority and
  description (at most 4,096 characters), the issue's link, and the labels `assigned`, its state type and its labels.
- **A notification event**: kind `issue` (`event` when it names no issue), `external_id` `notification:<id>`, the
  actor as `linear:<user id>`, the issue's identifier, title and link, and the labels `notification` and its type.
- **Account and owner**: `account` is the workspace's URL key (`get_workspace`), and `owner` the signed-in user
  (`get_user` with `me`) as `linear:<user id>` and their name. Memory compares the owner with the person it collects
  for. `account` and `source` are optional inputs: another workspace is `ACCOUNT_UNKNOWN`, another source
  `SOURCE_UNKNOWN`.
- **Cursor**: opaque, at most 1,024 characters. It holds the update time and key of the last issue change listed, the
  same for the last notification, and a digest of the workspace and user, so another workspace's or sign-in's cursor
  is `CURSOR_INVALID`. A cursor wins over `since`; without either, the listing starts 24 hours ago. An older cursor
  lists the same events again.
- **Limits**: `limit` is 1 to 500 (100 by default); a result stops early, with `more: true`, rather than pass 900 KB.
  One call reads at most 8 pages of 250 issues and 5 pages of 100 notifications; more is `TOO_MANY_CHANGES`, never a
  skip.
- **Permissions**: it asserts `linear_events_list`, then each Linear read it makes goes through OpenCode's own
  executor, so `linear_get_workspace`, `linear_get_user`, `linear_list_issues` and `linear_get_notifications` follow
  their own rules. With the default rules none of them asks. Every result carries `trust: "untrusted"`: issue and
  notification text is other people's, never instructions.

## Errors

Every error from the plugin reads `CODE: What happened. Next step: What to do.`

| Code | When | Next step |
| --- | --- | --- |
| `OPTIONS_INVALID` | Setup: an option is unknown or has a wrong value. `/plugins` shows the message, which names the option and the accepted values. | Fix the plugin options in `opencode.json`. |
| `HOST_UNTESTED` | Setup: OpenCode is outside `>=2.2.3 <2.3.0`, and `allowUntestedHost` is not set. | Use OpenCode `>=2.2.3 <2.3.0`, or set `"allowUntestedHost": true`. |
| `STATUS_UNAVAILABLE` | `/linear-status`, `/linear` or the status RPC: the status could not be read, or the plugin is not running on the server. The RPC answers with its error `unavailable`. | The message's own next step: restart OpenCode and run the command again, or, when the plugin is not running, run `/plugins` to see why. |
| `SKILLS_INVALID` | Setup: a skill file is missing or broken. The plugin still starts; status shows the problem. | Reinstall the plugin. |
| `SERVER_NOT_REGISTERED` | Setup: the `linear` server could not be registered. Status shows the problem. | Restart OpenCode. |
| `RULES_NOT_ADDED` | Setup: the default permission rules could not be added, so Linear tools may run without asking. Status shows the problem. | Restart OpenCode. |
| `AUTH_REQUIRED` | `linear_issues` or `linear_events_list`: the Linear read it needs is unavailable because the `linear` server needs a sign-in. | Run `/connect` and choose Linear, then press `o` or Enter to open the link. |
| `SERVER_CONFLICT` | `linear_issues` or `linear_events_list`: your own `mcp.servers.linear` points at another URL than your `access` uses, so the tool does not call it. | Point it at the URL status names, or remove it, then restart OpenCode. |
| `TOOL_UNAVAILABLE` | `linear_issues` or `linear_events_list`: OpenCode does not list the Linear read it needs, because the `linear` server is connecting, disabled, failed or missing, or has not listed its tools yet. The message names the read and the state. | Status's next step for that state; when connected, wait a few seconds and run `/linear-status`. |
| `UPSTREAM_UNREADABLE` | `linear_issues`: Linear's `list_issues` answered with something other than a list of issues. `linear_events_list`: one of its reads answered in a shape it does not read. | `linear_issues`: call `list_issues` with assignee `me` instead, which returns Linear's answer as it is. `linear_events_list`: call the read the message names directly, and run `/linear-status`. |
| `UPSTREAM_ERROR` | `linear_events_list`: Linear answered one of its reads with an error. The message holds the first line, at most 300 characters, with tokens and URL query strings removed. | Run `/linear-status`, then call again with the same cursor. |
| `INPUT_INVALID` | `linear_events_list`: the input is not the contract's, such as a `limit` outside 1 to 500 or a `since` that is not an ISO date or date-time. | Pass `since`, `cursor`, `limit`, `account` or `source` as the schema describes them. |
| `SOURCE_UNKNOWN` | `linear_events_list`: `source` is not `linear`. | Leave `source` out, or pass `linear`. |
| `ACCOUNT_UNKNOWN` | `linear_events_list`: `account` is not the signed-in workspace's URL key. | Leave `account` out, or pass the key the message names. |
| `CURSOR_INVALID` | `linear_events_list`: the cursor is malformed, another source's, or another workspace's or sign-in's. | Call without a cursor, with `since`, to start again. |
| `TOO_MANY_CHANGES` | `linear_events_list`: more assigned issues or notifications changed after the cursor or `since` than one call reads. | Call again with a later `since`, without a cursor. |

For example:

```text
OPTIONS_INVALID: The option "access" must be "all" (the default), "ask-changes" or "read-only", found "admin". Next step: Fix the plugin options in opencode.json, for example "plugins": [{ "package": "@joe-broadhead/opencode-linear", "options": { "access": "read-only" } }].
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
| `access` | `all`, `ask-changes` or `read-only`; with the deprecated `read` or `write` mapped, and `deprecation` naming it |
| `source` | `type` (`plugin`, `adopted` or `conflict`), `url`, and for a conflict the `expected` URL |
| `tools` | How many Linear tools OpenCode lists |
| `unknownCount`, `unknownTools` | How many of them the plugin does not know, and at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `unguardedAgents` | Agents where a new Linear tool would run without asking; empty when there are none. An agent whose own rules already ask or deny for every Linear tool is not listed. |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `problems` | Setup problems, each `CODE: What happened. Next step: What to do.` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

When the status cannot be read, the method answers with its error `unavailable`: the message
`STATUS_UNAVAILABLE: Could not read Linear's status (…).` and `data: { nextStep }`.
