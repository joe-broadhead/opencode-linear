# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

## Tools and permissions

79 tools are declared (43 read-only). Jelly's agents have no base "allow everything"
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
  shape. It is a direct tool, so Jelly sees its result.
- **My Linear issues**, a Home feed preset that calls `linear.issues` every 15 minutes.

## Signing in

Linear's MCP server `linear` signs in with OpenCode's MCP OAuth; read and write access are separate sign-ins. Jelly shows the card `mcp:linear`.

<!-- AUTH-PLACEHOLDER (Jelly rd152): settings and secrets for signing in from Jelly are being
designed by Jelly's auth lane. Until that lands this package declares no `contributes.settings`;
add the auth declarations here and in package.json when that design is agreed. -->
**Not yet declared for Jelly.** How this plugin's sign-in appears in Jelly (desktop and web,
expiry, reconnect and sign-out) is still being designed; this section and
`jelly.contributes.settings` will say it once it is.

## Versions

Jelly's curated catalogue pins an exact version. `latest` is `0.0.0`; publish each release
under a new version so a review in Jelly can tell the two apart.
