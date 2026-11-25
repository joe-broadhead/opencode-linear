# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `get_workspace`, `get_user` |
| `events_list` | read | optional | `get_workspace`, `get_user`, `list_issues`, `get_notifications` |
| `issues` | read | optional | `list_issues` |
| `mcp:*` | write | optional | — |
| `mcp:create_attachment` | write | optional | `create_attachment` |
| `mcp:create_attachment_from_upload` | write | optional | `create_attachment_from_upload` |
| `mcp:create_initiative_label` | write | optional | `create_initiative_label` |
| `mcp:create_issue_label` | write | optional | `create_issue_label` |
| `mcp:delete_attachment` | delete | optional | `delete_attachment` |
| `mcp:delete_comment` | delete | optional | `delete_comment` |
| `mcp:delete_diff_comment` | delete | optional | `delete_diff_comment` |
| `mcp:delete_status_update` | delete | optional | `delete_status_update` |
| `mcp:extract_images` | read | optional | `extract_images` |
| `mcp:get_agent_skill` | read | optional | `get_agent_skill` |
| `mcp:get_attachment` | read | optional | `get_attachment` |
| `mcp:get_diff` | read | optional | `get_diff` |
| `mcp:get_diff_threads` | read | optional | `get_diff_threads` |
| `mcp:get_document` | read | optional | `get_document` |
| `mcp:get_initiative` | read | optional | `get_initiative` |
| `mcp:get_issue` | read | optional | `get_issue` |
| `mcp:get_issue_status` | read | optional | `get_issue_status` |
| `mcp:get_milestone` | read | optional | `get_milestone` |
| `mcp:get_notifications` | read | optional | `get_notifications` |
| `mcp:get_project` | read | optional | `get_project` |
| `mcp:get_release` | read | optional | `get_release` |
| `mcp:get_release_note` | read | optional | `get_release_note` |
| `mcp:get_status_updates` | read | optional | `get_status_updates` |
| `mcp:get_team` | read | optional | `get_team` |
| `mcp:get_template` | read | optional | `get_template` |
| `mcp:get_triage_responsibility` | read | optional | `get_triage_responsibility` |
| `mcp:get_user` | read | optional | `get_user` |
| `mcp:get_workspace` | read | optional | `get_workspace` |
| `mcp:list_agent_skills` | read | optional | `list_agent_skills` |
| `mcp:list_comments` | read | optional | `list_comments` |
| `mcp:list_custom_views` | read | optional | `list_custom_views` |
| `mcp:list_cycles` | read | optional | `list_cycles` |
| `mcp:list_diffs` | read | optional | `list_diffs` |
| `mcp:list_documents` | read | optional | `list_documents` |
| `mcp:list_initiative_labels` | read | optional | `list_initiative_labels` |
| `mcp:list_initiatives` | read | optional | `list_initiatives` |
| `mcp:list_issue_labels` | read | optional | `list_issue_labels` |
| `mcp:list_issue_statuses` | read | optional | `list_issue_statuses` |
| `mcp:list_issues` | read | optional | `list_issues` |
| `mcp:list_milestones` | read | optional | `list_milestones` |
| `mcp:list_project_labels` | read | optional | `list_project_labels` |
| `mcp:list_projects` | read | optional | `list_projects` |
| `mcp:list_release_notes` | read | optional | `list_release_notes` |
| `mcp:list_release_pipelines` | read | optional | `list_release_pipelines` |
| `mcp:list_releases` | read | optional | `list_releases` |
| `mcp:list_teams` | read | optional | `list_teams` |
| `mcp:list_templates` | read | optional | `list_templates` |
| `mcp:list_users` | read | optional | `list_users` |
| `mcp:mark_notification` | write | optional | `mark_notification` |
| `mcp:merge_diff` | write | optional | `merge_diff` |
| `mcp:prepare_attachment_upload` | write | optional | `prepare_attachment_upload` |
| `mcp:prepare_file_upload` | write | optional | `prepare_file_upload` |
| `mcp:resolve_diff_thread` | write | optional | `resolve_diff_thread` |
| `mcp:restore_initiative_label` | write | optional | `restore_initiative_label` |
| `mcp:restore_issue_label` | write | optional | `restore_issue_label` |
| `mcp:restore_project_label` | write | optional | `restore_project_label` |
| `mcp:retire_initiative_label` | write | optional | `retire_initiative_label` |
| `mcp:retire_issue_label` | write | optional | `retire_issue_label` |
| `mcp:retire_project_label` | write | optional | `retire_project_label` |
| `mcp:save_comment` | send | optional | `save_comment` |
| `mcp:save_diff_comment` | send | optional | `save_diff_comment` |
| `mcp:save_document` | write | optional | `save_document` |
| `mcp:save_initiative` | write | optional | `save_initiative` |
| `mcp:save_initiative_label` | write | optional | `save_initiative_label` |
| `mcp:save_issue` | write | optional | `save_issue` |
| `mcp:save_issue_label` | write | optional | `save_issue_label` |
| `mcp:save_milestone` | write | optional | `save_milestone` |
| `mcp:save_project` | write | optional | `save_project` |
| `mcp:save_project_label` | write | optional | `save_project_label` |
| `mcp:save_release` | write | optional | `save_release` |
| `mcp:save_release_note` | write | optional | `save_release_note` |
| `mcp:save_status_update` | send | optional | `save_status_update` |
| `mcp:search_documentation` | read | optional | `search_documentation` |
| `mcp:share_issue` | share | optional | `share_issue` |
| `mcp:submit_diff_review` | send | optional | `submit_diff_review` |
| `mcp:unshare_issue` | share | optional | `unshare_issue` |
| `mcp:update_diff` | write | optional | `update_diff` |
| `mcp:whoami` | read | optional | `whoami` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `linear.activity` | events | `issue` | `events_list` | free |
| `linear.issues` | snapshot | `list` | `issues` | free |

### Actions

None.

### Bus events

`rpc.linear.status`, `rpc.linear.account`
<!-- /generated:capabilities -->

## Notes

- **`status`** takes no account. It reports the plugin's version, the OpenCode host, one entry per alias from
  OpenCode's MCP server list, the agents that lack the generated rules, and a next step. It reads no Linear content.
- **`probe`** reads one alias's owner and workspace, through `get_workspace` and `get_user`. It reads no issue and no
  notification.
- **`events_list`** reads the `linear` source for one alias: changes to issues assigned to that account and its
  notifications, oldest first. A cursor is bound to the plugin, source and account; another account's cursor is
  `CURSOR_INVALID`. One feed failing lists the other and names the failed feed in `failed[]` as `feed:issues` or
  `feed:notifications`, with that feed's position kept in the cursor.
- **`issues`** answers the `linear.issues` snapshot: up to fifty assigned issues as the contract's `list` output,
  most recently updated first, in every state. It is a sample, not a count. It reads only `list_issues`; the identity
  reads (`get_workspace`, `get_user`) belong to `probe`, and to the activity page's own identity check.
- **The `mcp:` methods** are Linear's own MCP tools, declared one by one so each has its class: 42 reads, 26 writes,
  four sends, four deletes and two shares. `mcp:*` is one more write rule, emitted before them, so a tool Linear
  renames or adds is denied at `read-only` and asked at `ask-changes` instead of falling through to OpenCode's base
  allow-all. The server owns them; the manifest states their risk.
- **The activity source** is private, free, and 900 KB per page. Its event URLs are on `linear.app`. The issues
  snapshot is private, free, and 64 KB.
- **No actions:** the plugin has no write of its own and nothing to preview or commit. Writes are Linear's tools.
- **Bus events:** `account` when status finds an alias that needs a sign-in or failed; `status` once when the plugin
  finishes setup. A read emits nothing, and the plugin owns no write to announce.
