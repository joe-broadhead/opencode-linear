# Scripting

A script can call Linear's tools with no model: a cron job, a shell script, or any program that can reach the
OpenCode server. It uses the tools RPC, `linear.workspace.tools`, through `opencode api` or an OpenCode client.

| Method | Class | The tool |
| --- | --- | --- |
| one per known Linear tool, named after it: `list_issues`, `get_issue`, `get_project`, `save_issue`, `save_comment` and the others | `read` or `write` | `linear_<method>`, such as `linear_list_issues` |
| `issues` | read | `linear_issues`, the plugin's own: your assigned issues as a table, one row each |
| `describe` | none | none: lists every method with its class, its permission action, whether OpenCode lists its tool now, and its input as JSON Schema; given a session, it also gives each method's `permission` |

The methods are exactly the tools this plugin knows (`METHODS` in `src/host/tools-rpc.ts`): the 41 reads and the 36
writes of `READ_TOOLS` and `WRITE_TOOLS` in `src/linear-tools.ts`. A tool Linear adds later is not a method.

Each method runs Linear's own tool with the same input, through OpenCode's own connection and sign-in. The plugin
never sees the OAuth token. With `access: "read"` (the default) only Linear's read-only server is registered, so
`describe` marks every write unavailable and a write fails with `TOOL_UNAVAILABLE`; with `access: "write"` the full
server lists them, and a write then needs a prior `allow` (below).

`issues` runs the plugin's own `linear_issues`, as the model does: it reads through the host's `linear_list_issues`
executor, so that read's rules apply too. Its input is `{ "limit"?: 1 to 100 }`, 25 by default. It returns
`{ "columns", "rows" }`: identifier, title, state, priority and link for each issue assigned to you.

## A rule must allow the call first

Every call resolves the method's permission action against the agent's rules and then the session's, the host's own
order; the last matching rule wins. Only `allow` runs:

- The plugin's default rules allow the 41 reads and `linear_issues`, and ask for every write, so a **read** needs
  nothing more.
- A **write**, such as `linear_save_issue` or `linear_save_comment`, needs a prior explicit `allow` in the session's or
  the agent's rules.
- An `ask` is refused with `PERMISSION_DENIED` before dispatch, because no one can answer a prompt, and no prompt is
  left waiting.
- A `deny` is refused too, and its next step names the rule to change.
- A saved "Always allow" from an earlier prompt does **not** authorize an ad-hoc script: it is not part of the agent's
  and session's rules, and a script's grant must be reviewable in config or in a job's approval. This is the one
  deliberate break from the earlier reads-only RPC.

An agent defined only in your config gets no default rules; `/linear-status` names it.

Create the session once, with the agent the script runs as, and keep its id:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do, and it can grant one write for
one script without touching the agent's rules. This one can list and read issues, and comment on one:

```sh
opencode api post /api/session -d '{"title":"triage digest","agent":"build","permissions":[
  {"action":"linear_*","resource":"*","effect":"deny"},
  {"action":"linear_list_issues","resource":"*","effect":"allow"},
  {"action":"linear_get_issue","resource":"*","effect":"allow"},
  {"action":"linear_save_comment","resource":"*","effect":"allow"}
]}'
```

A session rule also applies to that session's model turns. Create a session for the script alone. For a grant bound to
the exact script the user approved, use a Jobs one-off script job: its approval writes the run session's `allow` rules,
and the user sees the source, the methods and whom each write reaches before it exists.

The session must belong to the location you call. A session in another directory is `SESSION_UNKNOWN`.

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/linear.workspace.tools/get_issue -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{"id":"ENG-123"}
}}'
```

Send the location explicitly with `-H "x-opencode-directory:$PWD"`. Without it, the call goes to the service's
default location, your home directory, whatever directory you run the command from, and that location's plugin options
and `linear` connection: not always the project you mean. The HTTP equivalents are the `location[directory]` query
parameter and the same header.

The tool's input is Linear's, and Linear defines its fields: `describe` shows each tool's schema as OpenCode lists it
now. Check it rather than guess a field name. For example, `get_user` takes `query`, and `"me"` names the signed-in
user:

```sh
opencode api post /api/rpc/linear.workspace.tools/get_user -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"query":"me"}}}'
```

```sh
opencode api post /api/rpc/linear.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/linear.workspace.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

`describe` with a session gives each method's resolved `permission` (`allow`, `ask` or `deny`), which is how a script
self-checks before it writes a call.

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the tool's
text>}}`, as plain JSON. Linear content in it is untrusted data, written by other people.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON to standard output.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The rules resolve to `ask` (a script cannot answer) or to `deny`. The message names the action, which may be an inner one: `issues` reads through `linear_list_issues`, and names it. The next step names the rule to add or remove. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `linear` server at a URL other than the one your `access` uses. `/linear-status` names both. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `linear` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/linear-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, such as a write with `access: "read"`. |
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

- Run a write without a prior explicit `allow` in the agent's or the session's rules, or at all with `access: "read"`.
- Call a tool that is not a known one, even with an allow rule.
- Answer an approval prompt: an `ask` is refused.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from
any plugin, do not run for them.
