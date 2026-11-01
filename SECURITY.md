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

- The plugin adds no tools, runs no network requests of its own and stores nothing. It registers Linear's MCP server
  with OpenCode, and OpenCode connects, signs in and stores the credentials.
- The plugin never reads tokens. Status shows only the account label OpenCode reports, if any, and server URLs
  without their query strings.
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

1. **Linear's server.** With `access: "read"` (the default), the plugin registers Linear's read-only server,
   `https://mcp.linear.app/mcp/readonly`, with the `read` scope. It lists only tools that read, and Linear refuses
   changes through it. With `access: "write"`, the plugin registers `https://mcp.linear.app/mcp` with `read write`.
   The two servers have different addresses, so each needs its own sign-in. If you define `mcp.servers.linear`
   yourself, the plugin adopts it only at the URL for your `access`.
2. **Default permission rules.** Every Linear tool asks before it runs, except Linear's read tools listed in
   `src/linear-tools.ts`. Reads, `linear_extract_images` included, run without a prompt. To review each image fetch,
   add `{ "action": "linear_extract_images", "resource": "*", "effect": "ask" }` to your `permissions`.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the default
   rules. A `deny` you configure always wins.

Things to know:

- **Saved approvals are broad.** "Always allow" on a Linear tool saves the pattern `*` for that tool's action. It
  applies to every agent in the OpenCode project, Plan included, until you remove it. OpenCode identifies a project by
  its git repository. A folder outside any git repository with a commit may belong to OpenCode's shared `global`
  project, so an approval saved there may apply in other such folders too.
- **Some agents get no default rules.** Agents defined only in your own config, and agents added by plugins that load
  after this one, are created after the plugin inserts its rules, and agents without a base allow get none. Linear
  tools may run there without asking. `/linear-status` names these agents and gives the fix: put the block first in
  that agent's own `permissions`, followed by your top-level rules for `linear_*` tools. Do not put it in the
  top-level `permissions`, which would loosen Explore.
- **Unattended runs refuse prompts.** In `opencode run`, a Linear tool that would ask is refused.
- **The `linear_*` rule also matches other servers** whose names start with `linear_`. For their tools it only adds
  prompts.
