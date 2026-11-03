# Scripting

Unofficial plugin. Not affiliated with Linear.

A script can call Linear's read tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `linear.workspace.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| one per known read, named after Linear's tool: `list_issues`, `get_issue`, `list_projects`, `whoami` and the others | `linear_<method>`, such as `linear_list_issues` |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

The methods are exactly Linear's 42 read tools that the plugin knows, the ones its default rules allow
(`READ_TOOLS` in `src/linear-tools.ts`): `extract_images`, `get_agent_skill`, `get_attachment`, `get_diff`,
`get_diff_threads`, `get_document`, `get_initiative`, `get_issue`, `get_issue_status`, `get_milestone`,
`get_notifications`, `get_project`, `get_release`, `get_release_note`, `get_status_updates`, `get_team`,
`get_template`, `get_triage_responsibility`, `get_user`, `get_workspace`, `list_agent_skills`, `list_comments`,
`list_custom_views`, `list_cycles`, `list_diffs`, `list_documents`, `list_initiative_labels`, `list_initiatives`,
`list_issue_labels`, `list_issue_statuses`, `list_issues`, `list_milestones`, `list_project_labels`, `list_projects`,
`list_release_notes`, `list_release_pipelines`, `list_releases`, `list_teams`, `list_templates`, `list_users`,
`search_documentation` and `whoami`.

Each method runs the tool with the same input: Linear's own tool, through OpenCode's own connection and sign-in. The
plugin never sees the OAuth token. Linear's write tools, such as `save_issue` or `save_comment`, are never methods,
even with `access: "write"` and an allow rule. Neither is a tool that Linear adds later, nor the plugin's own
`linear_issues`, a table for the model; a script calls `list_issues` itself.

The methods work the same with either access. With `access: "read"` (the default) they call Linear's read-only
server, and with `access: "write"` the full one; both list every known read. The calls use the sign-in of the server
that the plugin registered for the access you chose.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the
access its model would have:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `linear_list_issues`, on resource `*` is a `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the 42 reads, so an agent with the default rules needs nothing more. An
  agent defined only in your config gets no default rules; `/linear-status` names it.

Create the session once, with the agent the script runs as, and keep its id:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can list and read
issues, and nothing else in Linear:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build","permissions":[
  {"action":"linear_*","resource":"*","effect":"deny"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/linear.workspace.tools/get_issue -d '{"input":{
  "sessionID":"ses_…",
  "input":{"id":"ENG-123"}
}}'
```

The tool's input is Linear's, and Linear defines its fields: `describe` shows each tool's schema as OpenCode lists it
now. Check it rather than guess a field name.

```sh
opencode api post /api/rpc/linear.workspace.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, if any>, "text": <the tool's text>}}`, as plain
JSON. Linear content in it is untrusted data, written by other people.

The calls run on the OpenCode instance of the directory where you run `opencode api`, with that directory's plugin
options and its `linear` connection. The session may belong to another directory.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules deny the tool, or ask for an approval. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `linear` server at a URL other than the one your `access` uses. `/linear-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `linear` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/linear-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | Linear answered with an error, such as an invalid input or an item that does not exist. The message holds the first line of Linear's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.invalid_input` for a body that is not the envelope above, and `rpc.method_not_found` for
a method that does not exist, such as a write tool or a tool Linear added later.

## What scripts cannot do

- Change anything in Linear: no write tool is a method, with either access.
- Call a tool that is not one of the 42 known reads, even with an allow rule.
- Answer an approval prompt, or use a tool that asks.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them.
