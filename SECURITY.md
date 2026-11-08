# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, API keys or Linear content.

Vulnerabilities in Linear's service or in OpenCode itself are out of scope. Report those to Linear or to the OpenCode
project.

## Data handling

- The plugin adds one read tool, `linear_issues`, which calls Linear's `list_issues` through OpenCode. It runs no
  network requests of its own and stores nothing. It registers Linear's MCP server with OpenCode, and OpenCode
  connects, signs in and stores the credentials. The tools RPC for scripts (see [Scripts](#scripts)) runs Linear's
  tools through OpenCode's own connection, too.
- The plugin never reads tokens. Status shows only the account label OpenCode reports, if any, and server URLs
  without their query strings. It never shows OpenCode's text for a needed sign-in, which can hold an authorization
  URL, and cuts a connection failure's reason to one line with no URL query.
- Linear content is untrusted. Issue titles, descriptions, comments and documents are written by other people and can
  contain instructions aimed at the model. The skills tell the model to treat Linear content as data.
- Tool results go to your model provider, like any other tool result in the session.
- `linear_extract_images` fetches images that Linear content links to.
- Maintainer drift check: `scripts/check-linear-tools.mjs` reads a Linear API key from the `LINEAR_API_KEY`
  environment variable and sends it only as a bearer header to Linear's MCP endpoint, or to another HTTPS or loopback
  endpoint given with `--endpoint`. It prints tool names and Linear's read-only and destructive hints, never the key or
  tool descriptions, and stores nothing. Use a read-only key.

## Permissions

What the model can do in Linear is limited by three layers, in this order:

1. **Linear's server.** With `access: "read-only"`, the plugin registers Linear's read-only server,
   `https://mcp.linear.app/mcp/readonly`, with the `read` scope. It lists only tools that read, and Linear refuses
   changes through it. Otherwise the plugin registers `https://mcp.linear.app/mcp` with `read write`, which is the
   default. The two servers have different addresses, so each needs its own sign-in. If you define
   `mcp.servers.linear` yourself, the plugin adopts it only at the URL for your `access`.
2. **Default permission rules: everything is allowed.** Every tool the plugin registers runs without a prompt, and so
   does a tool Linear adds later, so an agent can read and change everything the signed-in account can: issues,
   comments, projects, documents, initiatives and labels. Nothing asks first. To restrict it, set the plugin option
   `"access": "ask-changes"` (reads run, every change asks) or `"access": "read-only"` (reads run, every change is
   denied), give the agent its own later rules, or add a rule per tool. The README's Permissions section and
   `docs/configuration.md#permissions` have the three ways and the generated block. A read of other people's images,
   `linear_extract_images`, runs too; to review each fetch, add
   `{ "action": "linear_extract_images", "resource": "*", "effect": "ask" }` to your `permissions`.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on a Linear tool saves the pattern `*` for that tool's action. It
  applies to every agent in the OpenCode project, Plan included, until you remove it. OpenCode identifies a project by
  its git repository. A folder outside any git repository with a commit may belong to OpenCode's shared `global`
  project, so an approval saved there may apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Linear
  tools may run there without asking. `/linear-status` names these agents and gives the fix: put the default rules it
  shows first in that agent's own `permissions`, followed by your top-level rules for Linear tools. Do not put them in
  the top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, a Linear tool that would ask is refused.
- **The `linear_*` rule also matches other servers** whose names start with `linear_`. For their tools it only adds
  prompts.

## Scripts

The tools RPC (`linear.workspace.tools`, see
[docs/scripting.md](https://github.com/joe-broadhead/opencode-linear/blob/HEAD/docs/scripting.md)) calls Linear's tools
for a script, with no model. Every known tool is a method, with its class, but a method is not a grant:

- A script names a session that names an agent, and runs as them. Before any call, the plugin resolves that method's
  permission action against the agent's rules and then the session's rules, the host's own order. Only `allow` runs: a
  rule that resolves to `ask` is refused because no one can answer it, and a `deny` is refused. Neither makes a call.
  A script gets the same default as the model, so at `access: "all"` it can read and change what the account can;
  under `"ask-changes"` an ask is refused and under `"read-only"` a change is denied.
- A saved "Always allow" is **not** consulted: it lives outside the agent's and session's rules, so an old click does
  not authorize a new script. A grant is reviewable in config, or in a Jobs one-off's approval.
- After the resolve, an MCP call runs through OpenCode's own executor, which checks the action again, as it does for
  the model. `issues` runs the plugin's own `linear_issues` spec, which reads through the host's `linear_list_issues`,
  so that read's rules apply too. The plugin's permission hook still changes only an `ask` on one of its own script
  calls in flight, only to a deny, and leaves every other call alone.
- A tool Linear adds later is not a method, so a script cannot reach it until a release classifies it.
- The call goes through OpenCode's own MCP connection and sign-in. The plugin never sees the token, and returns none.
- Linear's error text reaches the script only as the first line, at most 300 characters, with tokens and URL query
  strings removed.
- A session in another location is `SESSION_UNKNOWN`, and a call that names no location reaches the service's default
  location: send `x-opencode-directory` with each call.
- OpenCode's `execute.before` and `execute.after` tool hooks, from any plugin, do not run for a script's call, so
  another plugin's policy hook does not see it. A script's calls are not recorded in the session.
- The RPC is reachable only by callers of the OpenCode server API, who already hold the server's full authority. The
  session is not a login: it scopes a script to what its agent may do.
