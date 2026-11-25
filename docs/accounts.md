# Accounts

Several Linear workspaces at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: Linear's MCP server holds the credentials. OpenCode adds one server per alias, named `linear`
for `default` and `linear-work` / `linear-personal` for the other aliases. Each has its own OAuth, so two aliases are
two independent sessions. Sign in through OpenCode's MCP sign-in, once per alias:

```sh
opencode mcp auth linear-work
opencode mcp auth linear-personal
```

Each server points at Linear's one MCP endpoint, `https://mcp.linear.app/mcp`. The server's name is what keeps the two
sign-ins apart; the workspace is chosen during that server's sign-in.

## Profiles

An alias has no profile fields: the sign-in decides the workspace. `accounts` maps each alias to an empty object,
`{ "work": {}, "personal": {} }`. An unknown field is refused with `OPTIONS_INVALID`, so a typo cannot silently read the
wrong workspace.

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and no account, the call is refused with
`ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the plugin does not serve is `ACCOUNT_UNKNOWN`.

The plugin's own methods read through the alias's MCP server, so an alias can only read the workspace that server is
signed in to. Cursors are bound to the account: a cursor issued for `work` and passed with `personal` is
`CURSOR_INVALID`, never a silent restart.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`. The state comes
from OpenCode's MCP server list, so status never calls Linear. A failure's reason is one line of at most 160
characters, with query values, bearer credentials and token-shaped words replaced.
