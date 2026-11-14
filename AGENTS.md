# Repository rules

This repository builds `@joe-broadhead/opencode-linear`, an OpenCode plugin that registers Linear's official MCP
server and adds default permission rules, a status command, a status dialog, two skills, two read tools of its own
(`linear_issues` and `linear_events_list`) and a tools RPC for scripts.
Read [docs/architecture.md](docs/architecture.md) before you change code, and [CONTRIBUTING.md](CONTRIBUTING.md) for
the checks and the release steps.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.2.3 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.2.3 <2.3.0`, never `^2.2.3`. `TESTED_HOSTS` in
  `src/constants.ts` is the one list of tested releases (2.2.3, 2.2.4, 2.2.5 and 2.2.6): status calls only those tested,
  the host and pack stages and CI run on each. Inside the range an untested release still starts.
- **Greenfield.** No legacy, migration code, compatibility shim, dual path or deprecated alias, and nothing dead.
  Delete rather than deprecate.
- **No peers, no runtime dependencies, no lifecycle scripts.** `@opencode/plugin`, `@opencode/sdk` and
  `@opencode/client` (whose types the host tests use) are devDependencies pinned to exactly `2.2.3`. Do not add another host version to the lockfile: the host stage installs
  the other tested SDKs into a temp folder.
- **Ship prebuilt, one file per entry.** `scripts/build.mjs` bundles `src/index.ts` and `src/tui.ts` with esbuild into
  the self-contained `dist/index.js` and `dist/tui.js`: no chunks, no relative imports, and only host-provided modules
  external. `tsc` only typechecks. No declaration files, `.tsx` or JSX.
- **Default rules, not hooks.** Permissions come from rules inserted through `ctx.agent.transform` directly after each
  agent's base allow. A stricter agent is never weakened. Agents that miss the rules are named in status with the
  per-agent fix, never patched, and the fix never goes in the top-level `permissions`.
- **Transforms are cheap, synchronous and never throw.** Record failures for status instead.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `linearError` or `errorText`. Codes have no
  service prefix; shared failures use the shared names (`HOST_UNTESTED`, `OPTIONS_INVALID`, `STATUS_UNAVAILABLE`,
  `SKILLS_INVALID`).
- **Status.** `src/status.ts` builds one model for `/linear-status`, the `/linear` dialog and the status RPC. The RPC
  keeps the fields every plugin of this family shares, `version`, `host` (`version`, `range`, `tested`), `state`,
  `unguardedAgents` and `nextStep`, under those names. It never shows OpenCode's text for a needed sign-in, cuts a
  failure's reason to one line of 160 characters without URL queries, and names at most 20 unknown tools, plain names
  only. A status it cannot read is the declared RPC error `unavailable`, with a next step.
- **`src/linear-tools.ts` and `src/constants.ts` have no runtime imports.** The drift script and `scripts/check.mjs`
  load them with Node's type stripping. `READ_TOOLS` is exactly what Linear's read-only server lists
  (`test/unit/linear-catalog.ts`).
- **`linear_issues` is the one model tool of the plugin's own.** It reads through the host's `linear_list_issues`
  executor, never with a credential of its own, and its default rule allows it. It stays a direct tool
  (`codemode: false`) on purpose: Jelly draws its `table` card only from a direct call's result. That makes it present
  in every session, also when Code Mode holds Linear's other tools, so add no other direct tool without the same
  reason. Its answer keeps Jelly's `table` shape: at most 8 columns, 100 rows and 200 characters a cell.
- **`linear_events_list` is Memory's source of Linear events** (`src/events.ts`), a Code Mode tool and the tools RPC's
  one owned method, `events_list`. It keeps the shared `events_list` contract in `src/host/events-list.ts`, a copy
  every source plugin carries unchanged (`scripts/check-copies.mjs` pins its hash): change it in every source plugin at
  once. It asserts its own action, reads only through the host's executors, never writes, never asks with the default
  rules, and its tests run the contract's conformance check on synthetic fixtures.
- **The `jelly` section** of `package.json` declares every known tool, the skills, the `linear_issues` table card,
  the Home feed, the sign-in, a one-line `summary` and the `icon`, with only fields that Jelly's declaration schema
  accepts: it refuses unknown keys, so a Jelly without `summary` and `icon` refuses the declaration.
  `test/unit/jelly.test.ts` keeps it in step with the known tools and the default rules.
- **The icons** `assets/icon.svg`, `assets/icon-128.png` and `assets/icon-256.png` are Linear's logomark, from the
  brand assets Linear publishes at https://linear.app/brand, used under those guidelines: the mark unaltered and only
  scaled (its path data is pre-scaled to the family's 48 grid), in Mercury White `#F4F5F8` on a tile in Nordic Gray
  `#222326`, Linear's own colours. Never replace it with the stylised app icon (it needs filters, which Jelly refuses),
  never recolour or combine it with other graphics, and keep the README's trademark line. They are checked by
  `scripts/check-icons.mjs`, which is a byte-identical copy of the kit's. `opencode.icons` declares the three
  files, `opencode.vendor` declares Linear as the vendor with `mark: true` (the icon is the vendor's own mark), and the
  three `exports` and three `files` entries ship them.
- **The workflows are linted** by `actionlint` (`scripts/actionlint.mjs`, and a CI job), because a `${{ }}` that exists
  in some contexts only makes GitHub reject the whole file and run nothing.
- **TypeScript.** No enums, namespaces or parameter properties. `import type` for types, `.js` in relative imports.
- **The tools RPC.** `src/host/tools-rpc.ts` is a copy of a module shared by several plugins. Change only its block
  between the `PLUGIN-SPECIFIC` markers here; change the rest in the shared copy first. Its methods are every known
  tool (`READ_TOOLS` and `WRITE_TOOLS`, each with its class) and the owned read `issues`, never an unknown tool. A rule
  must allow a method before a script runs it: an `ask` is refused, and a saved "Always allow" is not a grant. Keep the
  RPC id `linear.workspace.tools` and its method names stable: scripts call them by name.
- **Tests.** Unit tests use narrow `Pick<Plugin.Context, ...>` fakes. Host tests use the public `@opencode/sdk` with
  `OpenCode.create({ app: { version } })`, a loopback fake server and the temp root from `test/host/isolate.ts`.
  Every temp root of the host and pack tests is a git repository under the system's `/tmp`, never under `TMPDIR` or
  `HOME`, so OpenCode never finds a `.opencode` folder of whoever runs them; each stock server has its own port.
  Never sign in to Linear or call its API from a check.
- **Text.** Model-facing text and docs use plain language and describe what the code does now: no process
  narrative, test counts, machine-local paths, secrets or personal data.
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)). A
  release-prep PR sets `version` in `package.json` and the install specs and runs `node scripts/changelog.mjs release`;
  once it is on `master` and CI passed, start the release with
  `gh workflow run release.yml --ref master -f sha=<its full sha>`. The workflow builds `dist/`, makes the release
  commit on a temporary `release/v<version>` branch, checks and stages everything, and waits for the owner to approve
  the `release` environment; only then does it create the tag `v<version>` and the GitHub Release. Never push a tag or a
  `release/*` branch, and never commit, tag or publish a release by hand. Agents never approve a release, never call the
  deployment-approval API, and never bypass a ruleset or the environment.
- **No personal email in anything we publish.** Every commit is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`, except the release commit and tag, which the
  release workflow makes as `github-actions[bot]`. Before committing or tagging, check that
  `git config user.email` is that address: a fresh clone inherits the machine's global identity, which is not that
  address. Never commit, tag or publish with a work or personal address, or with a local hostname.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get
  green.

## Forbidden in this repository

`scripts/check-forbidden.mjs` enforces this list in `src/`, `test/`, `scripts/` and `dist/`:

- dispatch-lease, catalog-ownership and text-only markers, and tool `options.mcp` delegation;
- `Plugin.image` and profile images;
- imported OAuth grants;
- the V1 plugin API: `@opencode-ai/*` packages and hooks such as `tool.execute.before`, `chat.message` or
  `permission.ask`;
- the deprecated `ctx.generate.text` and `experimental.policies`;
- importing `@opencode/ai`;
- a permission hook, except the one `permission.hook("evaluate")` in `src/host/tools-rpc.ts` (and the bundle that
  inlines it), exactly once each: it turns an `ask` on one of the tools RPC's own script calls in flight into a deny,
  because no one can answer it, and touches nothing else;
- references to private host source or host checkouts;
- machine-local home and temp paths;
- `.tsx` or `.jsx` files in `dist/`.

The pack test also rejects anything in `dist/` other than the two bundles, any relative, dynamic or `require` import in
them, and any import of a module OpenCode does not provide.
