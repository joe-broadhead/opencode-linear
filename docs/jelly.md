# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Linear** (`jelly.title`), with the package name and version beneath.

## Tools and permissions

78 tools are declared (42 read-only): Linear's 41 reads and 36 writes, and the plugin's own
`linear_issues`. Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `linear_create_attachment`, `linear_create_attachment_from_upload`, `linear_create_initiative_label`, `linear_create_issue_label`, `linear_delete_attachment`, `linear_delete_comment`, `linear_delete_diff_comment`, `linear_delete_status_update`, `linear_mark_notification`, `linear_merge_diff`, `linear_prepare_attachment_upload`, `linear_prepare_file_upload`, `linear_resolve_diff_thread`, `linear_restore_initiative_label`, `linear_restore_issue_label`, `linear_restore_project_label`, `linear_retire_initiative_label`, `linear_retire_issue_label`, `linear_retire_project_label`, `linear_save_comment`, `linear_save_diff_comment`, `linear_save_document`, `linear_save_initiative`, `linear_save_initiative_label`, `linear_save_issue`, `linear_save_issue_label`, `linear_save_milestone`, `linear_save_project`, `linear_save_project_label`, `linear_save_release`, `linear_save_release_note`, `linear_save_status_update`, `linear_share_issue`, `linear_submit_diff_review`, `linear_unshare_issue`, `linear_update_diff`.
- Off: none.
- Everything else runs, as the plugin's own rules let it.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/**/jelly.test.ts` checks
each declared effect against the plugin's own default rules.

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

`jelly.signIns` declares one sign-in, `linear`, for Linear's MCP server `linear`, which signs in with OpenCode's MCP OAuth. Read and write access are different servers with different tokens, so changing `access` needs a new sign-in, and the row says Not signed in until then.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Versions

Jelly's curated catalogue pins an exact version, so publish each release under a new version: a review in Jelly
can then tell the two apart.
