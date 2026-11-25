# Security

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.

## What this plugin holds

Nothing. Linear's MCP server holds the credentials, OpenCode owns sign-in and the plugin stores no token. The plugin's
own reads go through OpenCode's executors for Linear's MCP tools; it makes no network call of its own.

See [docs/security.md](docs/security.md) for the data flow, the scopes and the redaction.
