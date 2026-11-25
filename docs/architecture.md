# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, `assertHost`, the account wiring, the skills and one `register` call |
| Accounts | `src/accounts.ts` | one Linear MCP server per alias, through the contract's `accounts` module |
| Skills | `src/skills.ts` | every `skills/<id>/SKILL.md`, parsed and added through `ctx.skill.transform` |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Handlers | `src/handlers/` | one handler per method: the input, the answer schema, the description and the work |
| Provider | `src/provider/client.ts` | Linear's MCP reads, normalised into the contract's page, probe and snapshot answers |

The entry is deliberately thin. `register` from the contract wires doors 1–3: one agent tool per method in the
`linear` namespace, the same tools in Code Mode, one RPC registration under `linear`, the permission assertions on
`<alias>:<operation>`, the access rules inserted into every agent, and the bus. This repository never calls `ctx.tool`,
`ctx.rpc`, `ctx.permission` or `ctx.agent` itself. The one exception is `ctx.skill.transform`: the contract's
`register` does not load skills, so `src/skills.ts` registers them directly.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0`, unless `allowUntestedHost` is set.
3. `src/skills.ts` reads every `skills/*/SKILL.md` before the synchronous transform runs. A broken file becomes a
   `status` problem, never a setup failure.
4. The account wiring adds one MCP server per alias through `ctx.mcp.transform`, named `linear` or `linear-<alias>`.
5. `register` checks the handler table against `capabilities.methods`, resolves the accounts from the options,
   generates the access rules into every agent, and registers the tools and the single RPC id.
6. `ctx.skill.transform` adds each loaded skill, with its id, name, description, path and content. Setup returns one
   cleanup that disposes the skill transform and the registration.
7. A call resolves the account, validates the input against the handler's schema, asserts the method's operations,
   runs the handler against the provider, checks the answer and maps a failure to the contract's error table.

## Skills

OpenCode discovers skills inside a project's own `skills/` folder. A plugin's `skills/` folder sits in the installed
package, outside that project, so it is never discovered on its own: the plugin must register it. `src/skills.ts` lists
every directory in the package's `skills/` that holds a `SKILL.md`, parses its `---` frontmatter (a single-line value or
the folded `>` and literal `|` blocks) and the body, and validates that:

- the frontmatter `name` equals the folder name, which is the skill's id;
- a `description` exists;
- the content after the frontmatter is not empty.

A file that fails a rule is reported as a `SKILLS_INVALID` problem in `status`; the other skills still load, and the
server, rules and reads still work. The package ships `linear` and `linear-write`, and both are always registered: the
`access` option is enforced by the permission rules, not by hiding a skill.

## The provider

`src/provider/client.ts` is the only file that names Linear. It reads through the host's own MCP tool executors, one
server per alias: `linear_list_issues` for `default`, `linear-work_list_issues` for `work`. The plugin holds no token
and asserts no permission on the tool; the host checks the MCP tool's own rules when it runs it.

The provider builds every answer with the contract's own modules:

- `makeEvent` normalises an issue or notification into an event and computes its hash;
- `screenEvents` refuses an item that holds a secret;
- `fitPage` keeps a page inside the source's `maxBytes`;
- `eventsListResult` and `probeResult` build the page and the probe answer;
- `encodeBoundCursor` / `decodeBoundCursor` bind a cursor to the plugin, source and account.

It carries a two-minute lookback: a write Linear shows after a listing read past its time is still listed once, by the
hashes the cursor keeps for that window. When more changed than one call reads, the page answers `gap` once and says
where it resumes. When one of the two feeds cannot be read, the page lists the other, names the failed feed in
`failed[]`, and keeps that feed's position in the cursor for the next read.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version` | `assertHost` and status |
| `ctx.mcp.transform` | `src/accounts.ts` |
| `ctx.mcp.list` | `status` |
| `ctx.skill.transform` | `src/skills.ts` |
| `ctx.tool.list`, tool `execute` | the provider, for Linear's reads |
| `ctx.agent.transform` | `register`'s rules |
| `ctx.agent.list` | the agent list `call.unguardedAgents()` reads for status |
| `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## State and caching

The plugin keeps no content cache and no credential. The consumer owns the cursor and stores it; the plugin binds the
cursor to the account and refuses one that another account presents. `status` reads OpenCode's MCP server list on
demand and never calls Linear.

## Build

`scripts/bundle.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild. `@opencode/*` stays external, because
OpenCode provides it; the contract modules are bundled, so an install needs no build. `dist/` is generated by
`npm run bundle` and is committed, so a git install never runs a lifecycle script. The bundle finds the skills at
`../skills/` from its own URL, which is the installed package's `skills/` folder; `package.json` `files` ships that
folder, and `test/host/skills.test.ts` proves the built file registers both skills on the real 2.4.1 host.
