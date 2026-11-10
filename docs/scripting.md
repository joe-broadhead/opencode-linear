# Scripting

A script can call Linear's tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `linear.workspace.tools`, through `opencode api` or an OpenCode client. The
call is:

```sh
opencode api post /api/rpc/linear.workspace.tools/<method> -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"<id>","input":{…}}}'
```

| Method | Class | The tool |
| --- | --- | --- |
| one per known Linear tool, named after it: `list_issues`, `get_issue`, `get_project`, `save_issue`, `save_comment` and the others | `read` or `write` | `linear_<method>`, such as `linear_list_issues` |
| `issues` | read | `linear_issues`, the plugin's own: your assigned issues as a table, one row each |
| `describe` | none | none: lists every method with its class, its permission action, whether OpenCode lists its tool now, and its input as JSON Schema; given a session, it also gives each method's `permission` |

The methods are exactly the tools this plugin knows (`METHODS` in `src/host/tools-rpc.ts`): the 41 reads and the 36
writes of `READ_TOOLS` and `WRITE_TOOLS` in `src/linear-tools.ts`, plus the plugin's own `issues`, appended at
registration. A tool Linear adds later is not a method.

Each method runs Linear's own tool with the same input, through OpenCode's own connection and sign-in. The plugin
never sees the OAuth token. `access` decides which of Linear's two servers is registered: `read-only` uses the
read-only server, so `describe` marks every write unavailable and a write fails with `TOOL_UNAVAILABLE`; otherwise the
full server lists them, and a write runs under the rules.

`issues` runs the plugin's own `linear_issues`, as the model does: it reads through the host's `linear_list_issues`
executor, so that read's rules apply too. Its input is `{ "limit"?: 1 to 100 }`, 25 by default. It returns
`{ "columns", "rows" }`: identifier, title, state, priority and link for each issue assigned to you.
`events_list` is the plugin's own read for Memory's collector. It runs `linear_events_list`'s own spec as the session
and its agent: it asserts `linear_events_list`, then reads `get_workspace`, `get_user`, `list_issues` and
`get_notifications` through OpenCode's executors, so each read's rules apply. Its own refusals are the codes in the
configuration guide's [errors](configuration.md#errors), such as `CURSOR_INVALID`; a refused read is
`PERMISSION_DENIED` naming that read.


## A script runs as a session

Every call names a session, and the session must name an agent. Create it for the script once, with the agent the
script runs as, and keep its id (`data.id` in the reply). Give the project as the session's `location`: a session made without one belongs to the service's default location, where the project's agents may not exist, and each call then fails `Agent not found`:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build","location":{"directory":"/path/to/project"}}'
```

Never borrow a session found through history or a session list: the script would run as that session's agent, under its
rules. The script then runs as that agent, with exactly the access its model would have:

- The rule for the call's permission action, such as `linear_list_issues` or `linear_save_comment`, is resolved
  **before** the tool runs, against the agent's rules and then the session's, in OpenCode's own order: the last
  matching rule wins.
- Only an `allow` runs. An `ask` is refused, because no one can answer a prompt for a script, and a `deny` is refused.
  Neither makes a tool call or leaves a prompt waiting. The plugin's default rules follow the `access` option: at the
  default, every known tool is allowed; restrict a script with `access`, with a later rule, or with the script's
  agent.
- A saved "Always allow" from an earlier prompt does **not** authorize an ad-hoc script: it is not part of the agent's
  and the session's rules, and a script's grant must be reviewable in config or in a job's approval.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.

Session rules come after the agent's, so a session can narrow what its script may do, and it can grant one action for
one script without touching the agent's rules. This one can list and read issues, and comment on one:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build","location":{"directory":"/path/to/project"},"permissions":[
  {"action":"linear_*","resource":"*","effect":"deny"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"},
  {"action":"linear_save_comment","resource":"*","effect":"allow"}
]}'
```

A session rule also applies to that session's model turns. Create a session for the script alone. For a grant bound to
the exact script the user approved, use a Jobs one-off script job: its approval writes the run session's `allow` rules,
and the user sees the source, the methods and whom each write reaches before it exists.

An agent defined only in your config gets no default rules; `/linear-status` names it.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/linear.workspace.tools/get_issue -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"id":"ENG-123"}}}'
```

The tool's input is Linear's, and Linear defines its fields: `describe` shows each tool's schema as OpenCode lists it
now. Check it rather than guess a field name. For example, `get_user` takes `query`, and `"me"` names the signed-in
user:

```sh
opencode api post /api/rpc/linear.workspace.tools/get_user -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"query":"me"}}}'
```

`describe` takes nothing, or a session to resolve each method's permission for:

```sh
opencode api post /api/rpc/linear.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/linear.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

`describe` with a session gives each method's resolved `permission` (`allow`, `ask` or `deny`), which is how a script
self-checks before it writes a call.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/linear.workspace.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

## Results

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined by
newlines. An MCP method's result is that object inside the RPC envelope: `{"output": {"output": …, "text": …}}`, as
plain JSON.

Linear content in it is untrusted data: issues, comments and documents are other people's words too.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to
standard output.

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch: the message says the action would ask, and the next step says to add an allow rule. A `deny` names the denied action, such as `linear_save_issue`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. The action may be an inner one: `issues` reads through `linear_list_issues`, and names it. |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, such as a write while the plugin uses Linear's read-only server. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `linear` server at a URL other than the one your `access` uses. `/linear-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `linear` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/linear-status` gives the details. |
| `UPSTREAM_ERROR` | Linear answered with an error, such as an invalid input or an item that does not exist. The message holds the first line of Linear's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Linear added later,
and `rpc.invalid_input` for a body that is not the envelope above, with one message per problem:

| Problem | Message |
| --- | --- |
| The envelope is not an object | `the envelope must be an object, such as {"sessionID":"<session>","input":<the tool's input>}` |
| A key other than `sessionID` and `input` | `"extra" is not allowed`, naming the key |
| `sessionID` missing, not a string, or empty | `"sessionID" must be a non-empty string` |
| `input` missing | `"input" is missing` |
| `input` not an object | `"input" must be an object` |
| `describe` given anything but `{}`, nothing, or `{sessionID}` | `describe takes nothing, or {"sessionID":"<session>"}` |

## What scripts cannot do

- Run a write without a prior explicit `allow` in the agent's or the session's rules, or at all when the plugin uses
  Linear's read-only server.
- Call a tool that is not a known one, even with an allow rule.
- Answer an approval prompt: an `ask` is refused.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them.
