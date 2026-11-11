// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";

// src/constants.ts
var PLUGIN_ID = "linear.workspace";
var SERVER_NAME = "linear";
var SUPPORTED_HOST = ">=2.2.3 <2.3.0";
var TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"];
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/host-version.ts
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var parse = (version) => RELEASE.exec(version)?.slice(1).map(Number);
var [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, "")));
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function isSupportedHost(version) {
  const parts = parse(version);
  return parts !== void 0 && compare(parts, LOWEST) >= 0 && compare(parts, ABOVE) < 0;
}

// src/host/events-list.ts
var EVENTS_LIST = "events_list";

// src/issues.ts
var ISSUES_TOOL = "issues";
var LIST = `${SERVER_NAME}_list_issues`;

// src/linear-tools.ts
var READ_TOOLS = [
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
  "search_documentation"
];
var WRITE_TOOLS = [
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
  "update_diff"
];

// src/options.ts
var ACCESS_VALUES = ["all", "ask-changes", "read-only"];

// src/permissions.ts
var actionOf = (tool) => `${SERVER_NAME}_${tool}`;
var rule = (tool, effect) => ({ action: actionOf(tool), resource: "*", effect });
function defaultRules(access = "all") {
  const other = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny";
  return [
    rule("*", other),
    ...[...READ_TOOLS, ISSUES_TOOL, EVENTS_LIST].map((tool) => rule(tool, "allow")),
    ...WRITE_TOOLS.map((tool) => rule(tool, other))
  ];
}

// src/status.ts
var SIGN_IN = `Run /connect and choose Linear, then press o or Enter to open the link (in a terminal, opencode mcp auth ${SERVER_NAME} opens it automatically).`;
var agentRulesText = (access) => defaultRules(access).map((rule2, index, rules) => `  ${JSON.stringify(rule2)}${index < rules.length - 1 ? "," : ""}`).join("\n");
var TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`;
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict"
};
var ACCESS_TEXT = {
  all: "every tool runs without asking, reads, changes and new tools included",
  "ask-changes": "reads run without asking; every change and every new tool asks first",
  "read-only": "read-only (Linear's read-only server; changes are not available)"
};
function serverText(source) {
  if (source.type === "plugin") return `${source.url}, registered by this plugin`;
  if (source.type === "adopted") return `${source.url}, your own mcp.servers.${SERVER_NAME}, used unchanged`;
  return `your mcp.servers.${SERVER_NAME} points at ${source.url}`;
}
function toolsText({ tools, unknownCount, unknownTools, access }) {
  if (unknownCount === 0) return `${tools} available, 0 unknown`;
  const more = unknownCount - unknownTools.length;
  const names = unknownTools.length ? `: ${unknownTools.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  const posture = access === "all" ? "unknown tools run too" : access === "read-only" ? "unknown tools are denied" : "unknown tools ask before running";
  return `${tools} available, ${unknownCount} unknown${names} (${posture})`;
}
function hostText({ host, problems }) {
  const { version, range, tested } = host;
  const outside = version === null || !isSupportedHost(version);
  const notes = [
    ...outside ? [`It is outside the supported range; the plugin runs because allowUntestedHost is true. If Linear misbehaves, use OpenCode ${TESTED_TEXT}.`] : [],
    ...problems
  ];
  return `${version ?? "unknown version"} (${tested ? "tested" : "untested"}; supported range ${range})${notes.length ? `. ${notes.join(" ")}` : ""}`;
}
function formatStatus(status) {
  const { source, unguardedAgents: agents } = status;
  const details = [status.error, source && serverText(source)].filter(Boolean).join("; ");
  return [
    "Linear status",
    `- Connection: ${STATE_TEXT[status.state]}${details ? ` (${details})` : ""}`,
    `- Account: ${status.account ?? "account name not reported by Linear's MCP"}`,
    `- Access: ${ACCESS_TEXT[status.access]}${status.deprecation ? ` (${status.deprecation})` : ""}`,
    `- Tools: ${toolsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}
${agentRulesText(status.access)}` : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Next step: ${status.nextStep}`
  ].join("\n");
}
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "state", "access", "tools", "unknownCount", "unknownTools", "unguardedAgents", "host", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          state: { enum: ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"] },
          error: { type: "string" },
          account: { type: "string" },
          access: { enum: [...ACCESS_VALUES] },
          deprecation: { type: "string" },
          source: {
            type: "object",
            required: ["type", "url"],
            properties: { type: { enum: ["plugin", "adopted", "conflict"] }, url: { type: "string" }, expected: { type: "string" } }
          },
          tools: count,
          unknownCount: count,
          unknownTools: strings,
          unguardedAgents: strings,
          host: {
            type: "object",
            required: ["version", "range", "tested"],
            properties: { version: { type: ["string", "null"] }, range: { type: "string" }, tested: { type: "boolean" } }
          },
          problems: strings,
          nextStep: { type: "string" }
        }
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } }
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "linear.workspace.tui";
var TITLE = "Linear status";
var KEYS = "r refresh \xB7 esc close";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatStatus(result.status).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The Linear plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error);
  return errorText("STATUS_UNAVAILABLE", `Could not read Linear's status (${reason}).`, "Restart OpenCode, then run /linear again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the account and the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(StatusRpc).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "linear.workspace.status",
        title: "Linear: Status",
        description: "Sign-in, account, access, tools and the next step for Linear",
        group: "Linear",
        palette: true,
        slash: { name: "linear" },
        run: () => show(false)
      },
      { id: "linear.workspace.status.refresh", title: "Refresh Linear status", group: "Linear", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  tui_default as default,
  setupView,
  viewMessage
};
