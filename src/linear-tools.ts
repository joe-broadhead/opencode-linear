// Linear's tool names, without the `linear_` server prefix. Keep this file free of runtime imports:
// scripts/check-linear-tools.mjs loads it with Node's type stripping to report upstream drift.

/** Known reads: exactly the tools Linear marks `readOnlyHint: true` (test/fixtures/live-tools.json). They always run. */
export const READ_TOOLS: readonly string[] = [
  "extract_images",
  "get_agent_skill",
  "get_attachment",
  "get_diff",
  "get_diff_threads",
  "get_document",
  "get_initiative",
  "get_issue",
  "get_issue_status",
  "get_milestone",
  "get_notifications",
  "get_project",
  "get_release",
  "get_release_note",
  "get_status_updates",
  "get_team",
  "get_template",
  "get_triage_responsibility",
  "get_user",
  "get_workspace",
  "list_agent_skills",
  "list_comments",
  "list_custom_views",
  "list_cycles",
  "list_diffs",
  "list_documents",
  "list_initiative_labels",
  "list_initiatives",
  "list_issue_labels",
  "list_issue_statuses",
  "list_issues",
  "list_milestones",
  "list_project_labels",
  "list_projects",
  "list_release_notes",
  "list_release_pipelines",
  "list_releases",
  "list_teams",
  "list_templates",
  "list_users",
  "search_documentation",
]

/**
 * Every other known tool: the ones Linear marks `readOnlyHint: false`. They follow the `access` option: allowed at
 * `all` (the default), asked about at `ask-changes` and denied at `read-only`. `whoami` only reports the signed-in
 * user and workspace, but Linear marks it not read-only, so it is classed with the changes; `get_user` with `me`
 * reads the same account at every access value.
 */
export const WRITE_TOOLS: readonly string[] = [
  "create_attachment",
  "create_attachment_from_upload",
  "create_initiative_label",
  "create_issue_label",
  "delete_attachment",
  "delete_comment",
  "delete_diff_comment",
  "delete_status_update",
  "mark_notification",
  "merge_diff",
  "prepare_attachment_upload",
  "prepare_file_upload",
  "resolve_diff_thread",
  "restore_initiative_label",
  "restore_issue_label",
  "restore_project_label",
  "retire_initiative_label",
  "retire_issue_label",
  "retire_project_label",
  "save_comment",
  "save_diff_comment",
  "save_document",
  "save_initiative",
  "save_initiative_label",
  "save_issue",
  "save_issue_label",
  "save_milestone",
  "save_project",
  "save_project_label",
  "save_release",
  "save_release_note",
  "save_status_update",
  "share_issue",
  "submit_diff_review",
  "unshare_issue",
  "update_diff",
  "whoami",
]

type ToolClass = "read" | "write" | "unknown"

export function classify(name: string): ToolClass {
  if (READ_TOOLS.includes(name)) return "read"
  if (WRITE_TOOLS.includes(name)) return "write"
  return "unknown"
}
