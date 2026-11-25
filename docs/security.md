# Security

## What leaves the machine

The plugin's own reads ask Linear's MCP server through OpenCode: the workspace and user behind an alias, the issues
assigned to it, and its notifications. Nothing else leaves the machine, and the plugin sends no content anywhere else.
Linear's own MCP tools send what the agent asks them to send, under OpenCode's rules.

## Credentials

Linear's MCP server holds the credentials. OpenCode adds one MCP server per alias and keys OAuth per server, so the
plugin never sees a token, a refresh token or a password. The plugin stores no credential and prints none.

## Scopes

The plugin requests no OpenCode scope of its own. Linear's MCP OAuth scopes are Linear's; the sign-in page states them.
Each alias is a separate sign-in, so a work workspace and a personal workspace never share a token.

## Untrusted data

Every answer is marked `trust: "untrusted"`. Issue titles, descriptions and notifications are data: the plugin never
follows them, never puts them in status, and never uses them to choose a tool or a recipient. Every event passes
through the contract's `screenEvents`, which refuses an item that holds a secret (`refused[]`, reason `secret`); a
refused item is never delivered.

## Redaction

`status.nextStep` and every account reason go through the contract's `redactReason`: query values, bearer credentials,
JWTs and token-shaped words are replaced, and the line is cut to 160 characters. Status and logs never carry a URL
query string, a token or a credential.

## Changes

The plugin has no write of its own, so it has no preview or commit to confirm. Writes are Linear's MCP tools, which
OpenCode runs under the same access rules and its own permission prompts; the plugin neither proxies nor observes them.
Under `ask-changes` every Linear change asks first, and under `read-only` every change is denied.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.
