# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One profile per account alias. An alias is one Linear workspace; it has no fields, because the sign-in chooses the workspace. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Two workspaces and read-only access

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/linear-plugin#v0.0.0",
      "options": {
        "access": "read-only",
        "accounts": { "work": {}, "personal": {} }
      }
    }
  ]
}
```

- `access` is the ceiling. `all` runs every method, `ask-changes` asks before a non-read, and `read-only` refuses one.
- `accounts` is one entry per alias. An alias has no fields; sign the alias's MCP server in to the workspace it should
  read. Without the option there is one `default` account, whose server is `linear`.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: an unsupported host gets
  `HOST_UNTESTED` and a next step.

## Errors

Every failure reads `CODE: What happened. Next step: What to do.` The generated table in the README lists the contract's
codes; this plugin raises none of its own. The common next steps:

- `NEEDS_SIGN_IN` — sign in to `linear` or `linear-<alias>` in OpenCode.
- `ACCOUNT_REQUIRED` — pass `account`, one of the aliases the options name.
- `ACCOUNT_UNKNOWN` — use an alias the options declare.
- `CURSOR_INVALID` — read again without the cursor; do not reuse another account's cursor.
- `HOST_UNTESTED` — install OpenCode 2.4.1, or set `allowUntestedHost`.
