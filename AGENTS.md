# Repository guide

`@we-the-rebel-alliance/linear-plugin` is an OpenCode plugin that registers Linear's official MCP server
(`https://mcp.linear.app/mcp`) as `linear`, adds default permission rules, a status command and dialog, two skills and
two reads of its own: `tools.linear.issues` and `linear_events_list`. [README.md](README.md) describes what it does for a
user; [docs/architecture.md](docs/architecture.md) describes the layers, and [CONTRIBUTING.md](CONTRIBUTING.md) the
checks and the release.

The repository is being rebuilt on plugin-contract v0. The current surface (the plugin id `linear.workspace`, the
`sources` and `jelly` keys, the copied kit scripts) is what the contract replaces.

## Commands

- `npm ci` installs the devDependencies; `npm run check` runs every stage and is the one command that must pass.
- `node scripts/check.mjs <stage>` runs one stage: `typecheck`, `unit`, `conformance`, `kit`, `build`, `icons`, `host`,
  `pack`, `forbidden`, `copies`, `whitelist`, `actionlint`. The full check runs the host and pack stages on the stock
  OpenCode in `TESTED_HOSTS`, so it binds fixed ports: never run two full checks at once on one machine.
- `npm run build` bundles `dist/index.js` and `dist/tui.js`; nothing else belongs in `dist/`.

## Rules

- **OpenCode 2.4.1 exactly.** `@opencode/plugin`, `@opencode/sdk` and `@opencode/client` are devDependencies pinned to
  `2.4.1`, and `effect` to `4.1.0` because the plugin peer needs it. `SUPPORTED_HOST` in `src/constants.ts` and
  `opencode.host` in `package.json` both say `>=2.4.1 <2.5.0`; `TESTED_HOSTS` is the one list of tested releases
  (`2.4.1`). Status calls only those tested, and the host and pack stages run on each. Inside the range an untested
  release still starts; outside it the plugin refuses with `HOST_UNTESTED` unless `allowUntestedHost` is set.
- **Public API only.** Use `@opencode/plugin` 2.4.1. `scripts/check-forbidden.mjs` bans internal APIs, the V1 plugin
  API and deprecated host surfaces.
- **Greenfield.** No legacy, compatibility shim, dual path or deprecated alias, and nothing dead. Delete rather than
  deprecate.
- **No runtime dependencies, peers or lifecycle scripts.** The bundle is self-contained: only host modules and Node
  built-ins stay external.
- **Default rules, not hooks.** Permissions come from rules inserted through `ctx.agent.transform` after each agent's
  base allow. A stricter agent is never weakened; agents that miss the rules are named in status, never patched. There
  are no per-request text hooks.
- **Transforms are cheap, synchronous and never throw.** Record failures for status instead.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `linearError` or `errorText`.
- **Fixed context.** The Code Mode namespace line is one string of at most 400 characters, every skill description is
  at most 300, nothing is pinned and nothing is a direct tool. A skill names tools as `tools.linear.<method>`.
- **`src/linear-tools.ts` and `src/constants.ts` have no runtime imports**, because `scripts/check.mjs` and the drift
  script load them with Node's type stripping. `READ_TOOLS` is exactly the tools Linear marks `readOnlyHint: true`,
  and `WRITE_TOOLS` the rest, in Linear's live list (`test/fixtures/live-tools.json`). `DESTRUCTIVE_TOOLS` names the
  changes that cannot be undone (the four deletes and `merge_diff`); the tools RPC classes them `destructive`.
- **The tools RPC.** Its transport is the source contract's `tools-rpc`, shared by the family; Linear's part is
  `src/tools-rpc.ts`. Its methods are every known tool with its class, plus the owned reads `issues`, `events_list` and
  `probe`; a tool Linear adds later is never a method. Keep the RPC id `linear.workspace.tools` and its method names
  stable: scripts call them by name.
- **`linear_events_list` is the source `linear.activity`** (`src/events.ts`), a Code Mode tool and the tools RPC method
  `events_list`, with `probe` beside it, under the source contract. It reads only, through the host's own executors,
  and an account it is asked for must be the signed-in one. `package.json`'s `sources` declares it and the list
  snapshot `linear.issues`.
- **The `jelly` section** of `package.json` is a declaration an app reads without loading the plugin. It stays until
  the contract's `capabilities` replaces it; `test/unit/jelly.test.ts` keeps it in step with the known tools and the
  default rules.
- **Text.** Model-facing text and docs describe what the code does now, in plain language: no process narrative, test
  counts, machine-local paths, secrets or personal data. The plugin names no app.
- **Tests.** Unit tests use narrow `Pick<Plugin.Context, ...>` fakes. Host tests use the public `@opencode/sdk` with
  `PromiseSdk.create({ app: { version } })`, a loopback fake server and the temp root from `test/host/isolate.ts`; the
  harness starts the Automation scheduler so Code Mode can run with nobody present, and waits for the plugin to be
  active before the first call. Never sign in to Linear or call its API from a check.
- **One check command.** `npm run check` passes before every commit. Never skip or weaken a test to get green.
