# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 22.18 or later, npm, and [Bun](https://bun.sh). CI uses Node.js 24 and Bun 1.4.5; the release uses
Node.js 24 and Bun 1.4.4, the Bun inside stock OpenCode 2.4.1.

```sh
npm ci --ignore-scripts
```

### Run your checkout in OpenCode

```sh
npm run build
```

Then list the folder in `plugins`, as an absolute path or a path relative to the config file that contains it, and
restart OpenCode. One entry loads both the server part and the terminal UI part. Run `npm run build` again after you
pull changes.

```json
{
  "plugins": ["/path/to/linear-plugin"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `test/`, strict, with unused names as errors |
| `unit` | `bun test ./test/unit`: every module in `src/`, the docs' counts and error table, and the `jelly` declaration |
| `conformance` | `bun test ./test/conformance`: the source contract's conformance kit (`@we-the-rebel-alliance/source-contract`, pinned in `package-lock.json`) over the source `package.json` declares, on recorded invented Linear answers (`test/fixtures/sources.json`) with no Linear call; it writes `reports/conformance-report.json` (git-ignored) for a release to attach |
| `kit` | `node --test scripts/release-kit.test.mjs`: the copied pre-4a release kit. Its planner still requires the old three-runner CI matrix (see [Releasing](#releasing)), so no release can be planned until 4b's plugin-kit replaces the copy |
| `build` | `node scripts/build.mjs`: deletes `dist/` and bundles `src/index.ts` and `src/tui.ts` with esbuild into the self-contained `dist/index.js` and `dist/tui.js`. Fails if a bundle imports anything the host does not provide |
| `icons` | `node scripts/check-icons.mjs`: the icon files against the family's icon contract |
| `host` | `bun test ./test/host`: the plugin inside an embedded OpenCode host, once on each tested release (`@opencode/sdk` 2.4.1) |
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, and loads it in stock OpenCode 2.4.1 |
| `forbidden` | `node scripts/check-forbidden.mjs`: scans `src/`, `test/`, `scripts/` and `dist/` for forbidden APIs and machine-local paths |
| `copies` | `node scripts/check-copies.mjs`: fails when a shared module's copy in this plugin differs from the one version every plugin carries |
| `whitelist` | Checks `package.json` against the approved package shape, and that `dist/` holds exactly `index.js` and `tui.js` |
| `actionlint` | `actionlint -color` over `.github/workflows/`, when `actionlint` is on `PATH`; otherwise the stage skips, and the `ci` job runs it before the full check |

To run some stages only, name them; they run in the order given:

```sh
node scripts/check.mjs typecheck unit
```

Shortcuts: `npm run typecheck`, `npm run build`, `npm test` (the `unit` stage), `npm run test:host`,
`npm run test:pack` and `npm run lint` (the `forbidden` stage).

`TESTED_HOSTS` in `src/constants.ts` is the one list of tested OpenCode releases: 2.4.1. The host
and pack stages, status and CI all take their versions from it. Add a release there, and to the README's
requirements, when every check passes on it.

The host stage starts an embedded OpenCode host in a temporary home folder, with a local fake of Linear's MCP server,
on the locked `@opencode/sdk` 2.4.1. A request to any address other than the local machine fails the test. To run the
stage against another installed SDK, put one in a separate folder and point `HOST_SDK_DIR` at it:

```sh
mkdir ../sdk-2.4.2 && cd ../sdk-2.4.2 && npm init -y && npm install @opencode/sdk@2.4.2 --ignore-scripts && cd -
HOST_SDK_DIR=../sdk-2.4.2 node scripts/check.mjs host
```

Every temporary folder of the host and pack stages is a git repository under the system's `/tmp`, never under
`TMPDIR` or your home folder. OpenCode looks for `.opencode` folders and project config upwards from a project, and
stops at a repository's root, so it never picks up your own agents or skills. Each stock server listens on its own
free port.

The pack stage needs network access to the npm registry. It checks that the tarball contains exactly the `files`
whitelist, with fewer than 30 entries and at most 100 KB; that `dist/` holds only `index.js` and `tui.js`, with no
relative import, dynamic `import()` or `require()`; and that they import only modules OpenCode provides. It
installs the tarball next to the host packages that OpenCode 2.4.1 provides and imports both entry points under Bun.
Then it installs the tarball alone and loads it with `opencode serve` from stock OpenCode 2.4.1. Each server
runs offline, in its own temporary home, on its own port with a password. The stage checks that every path in
`opencode debug paths` is inside that home, that the plugin is active, that the `linear` server and the default rules
are registered for both access modes, that `/connect` lists the server as "Linear", and that the status RPC answers.

To use an `opencode` binary you already have, set `OPENCODE_BIN_2_4_1`:

```sh
OPENCODE_BIN_2_4_1=/path/to/opencode-2.4.1 node scripts/check.mjs pack
```

Otherwise the stage installs `@opencode/cli` with the binary for your platform (macOS or Linux, arm64 or x64), a few
hundred megabytes per version, once per run, into a temporary folder that it deletes afterwards.

CI (`.github/workflows/ci.yml`) runs actionlint, then `npm ci --ignore-scripts` and `npm run check`, in one `ci` job on
Node 24; see [Releasing](#releasing) for its runner rule.

## Drift check for Linear's tools

`src/linear-tools.ts` lists the Linear tools the plugin knows: `READ_TOOLS` run without a prompt, and `WRITE_TOOLS`
ask. Linear can add, rename or remove tools at any time. The drift check is a manual maintainer check: it compares
Linear's live tool list with these lists. It is not part of `npm run check` or CI, and nothing at runtime depends on
it. Run it before a release, with a read-only Linear API key in `LINEAR_API_KEY`:

```sh
LINEAR_API_KEY=<read-only key> npm run drift
LINEAR_API_KEY=<read-only key> npm run drift -- --strict --endpoint <url>
```

- It needs Node.js 22.18 or later, which loads `src/linear-tools.ts` by stripping its types. Keep that file free of
  runtime imports.
- Create a read-only personal API key in Linear (Settings, Security & access). The key goes only into the bearer
  header. The script stores nothing.
- It prints only tool names, grouped as unclassified (served by Linear but in neither list), removed (listed but no
  longer served) and hint conflicts (the list disagrees with Linear's `readOnlyHint` or `destructiveHint`), with those
  two hints.
- `--endpoint` takes another HTTPS URL, or plain HTTP on a loopback address.
- Exit codes: `0` for no drift, or drift without `--strict`; `1` for drift with `--strict`; `2` for a usage, sign-in
  or connection error.
- Without a key, compare the lists with the tools OpenCode lists for a signed-in `linear` server instead: the Code
  Mode catalog's `linear` namespace.

### Updating the tool lists

1. Run the drift check.
2. For each name it reports, read the tool's description and schema, and check what it does.
3. Add a tool to `READ_TOOLS` only if it never changes anything in Linear, because reads run without a prompt and
   each one is also a method of the tools RPC for scripts. Add tools that change anything, or that Linear marks not read-only, to `WRITE_TOOLS`. Leave a
   tool out if you are not sure: it then asks before every call, and scripts cannot call it.
4. Remove names that Linear no longer serves.
5. Replace `test/fixtures/live-tools.json` and `provenance.json` with a new live capture, and update the declaration
   and the counts in the docs. Run `npm run check`. The tool-list test fails if `READ_TOOLS` differs from the tools
   Linear marks read-only, the live-tools test fails if the declaration and the capture disagree, the docs test fails on
   a stale count or method list, and the skills test fails if a skill names a tool that is in neither list.
6. Record the change in `CHANGELOG.md`. Moving a tool between the lists changes the default rules and the tools RPC's
   methods, which are part of the plugin's contract. Update the counts in `README.md`, `docs/configuration.md`,
   `docs/scripting.md` and `SECURITY.md` too.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the `/linear-status` command, the
`/linear` dialog, the skill names, the server name `linear` and its URLs, the status RPC method and the default rule
behaviour. While the major version is 0, a breaking change raises the minor version, and anything else the patch
version.

Each release supports one tested OpenCode line, stated as `opencode.host` in `package.json` and enforced by the host
check (`SUPPORTED_HOST` in `src/constants.ts`). Both must change together, with the README's requirements. Each
`CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

**The copied pre-4a release kit blocks planning until 4b replaces it.** Its planner still requires the old three-runner
CI matrix with macOS on a `master` push (`scripts/release-rules.mjs:260`; the check is called at
`scripts/release-github.mjs:155-156`), so it refuses this repository's one-job `ci.yml` with "no matrix is gated by
event". Its changelog script only knows `## [Unreleased]` and the released shape, so
`node scripts/changelog.mjs check` exits 1 on this repository's required `## 0.0.0 (unreleased)` heading. No release
can be planned until 4b's plugin-kit replaces the copied scripts.

The changelog's first section is `## 0.0.0 (unreleased)` at the top of `CHANGELOG.md`. Each earlier GitHub release is a
`## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and point every install spec at that tag. The
   README's Install section and the configuration examples use the `#v<version>` placeholder until the first release is
   cut; `test/unit/docs.test.ts` checks that every install spec names this package, uses the placeholder or the current
   concrete version, and never an untagged repository. Run `npm run check`. The changelog script cannot shape this
   CHANGELOG yet (above); 4b's plugin-kit must accept the heading first.
2. Push that commit to `master`, and wait for CI to pass on it. CI is the one job `ci` in `.github/workflows/ci.yml`, on
   a pull request and on a push to `master`: it runs actionlint, then the full `npm run check` on Node 24. Its single
   `runs-on` line is
   `${{ (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) && (vars.CI_RUNNER_PUBLIC || 'ubuntu-24.04') || 'ubuntu-24.04' }}`,
   so a push and a pull request from this repository use `vars.CI_RUNNER_PUBLIC` when it is set (default
   `ubuntu-24.04`), and a fork's pull request always uses `ubuntu-24.04`. There is no matrix and no macOS runner. The
   copied planner still refuses that shape (above), so no release can be planned until 4b replaces it.
3. Start the release with that commit's full sha:
   `gh workflow run release.yml --ref master -f sha=<full sha>`, or from Actions → release →
   Run workflow, on `master`.
4. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
5. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

`package.json` stays `"private": true`, so npm can never publish the plugin by accident; a GitHub install does not read
it, and `npm pack` still packs the release tarball. It is kept in its canonical form, `JSON.stringify(pkg, null, 2)` and
one newline: the kit tests check both in `npm run check`, as the release planner does.

The declaration is checked against what the provider serves. `npm run capture` (`scripts/capture-tools.mjs`, run by hand
through the signed-in OpenCode, never by CI) writes `test/fixtures/live-tools.json` and `test/fixtures/provenance.json`,
with the signed-in account's own values that some servers write into descriptions (Slack's "Your user_id: …") replaced
by placeholders such as `U00CURRENTUSER`; the drift check fails a committed capture that still holds one.
`scripts/check-drift.mjs` checks `jelly.tools`, `test/fixtures/tool-registry.json`, the skills and the docs against them,
offline, in the kit tests of `npm run check`. The release build runs it with `--release`, which also refuses a capture
more than 14 days old, unless `provenance.json` holds the owner's written waiver for exactly that capture:
`"waiver": { "listedAt": "<the capture's date>", "reason": "…", "approvedBy": "…" }` (a new capture drops it). A plugin
with no capture yet, or only a names-only one, releases with a warning on the run; one that serves only its own tools
says so with `"upstream": "none"` in the registry.

A plugin that declares sources (a top-level `sources` key in `package.json`, the source contract's declaration) releases
with its conformance report. Its `npm run conformance` runs the source contract's conformance kit and writes
`reports/conformance-report.json` (keep `reports/` out of git); `npm run check` runs it too. The release runs it again on
the parent in its own `conformance` job, which has no write token, and stops unless the run passes and the report's `ok`
is `true` for this version. The report becomes the Release asset `conformance-report.json`, listed in `SHA256SUMS`. A
plugin without `sources` has no report, and its release is unchanged.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful
  `ci.yml` push run with a successful job on every runner its push matrix names (macOS included), a `ci.yml` whose
  matrix runs macOS on a pull request or not on a push (the kit tests check it too), a `ci.yml` with no matrix gated by
  event (this repository's one-job file, above), a version that is not `x.y.z`, a
  `package.json` that is not `"private": true` or not in its canonical form, a CHANGELOG whose newest release is not
  this version, a plugin that declares sources with no `conformance` script, a release that does not move forward from
  the last published Release, a leftover `release/v<version>` branch, a native run that did not build this sha on
  `master`, by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds**: refuses a failing tool drift check (`scripts/check-drift.mjs --release`, above), then builds `dist/` with
  `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release files: `dist/`,
  `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.4.1);
- **packs** the commit before installing anything, keeps that tarball and records its sha256, then runs the pack stage
  against a copy;
- **runs the conformance kit** on the parent, for a plugin that declares sources (above), and uploads only its report;
- **stages** the Release: verifies the attested native files, takes the conformance report of a plugin that declares
  sources from its job's artifact (exactly that one file, at most 256 KiB, nothing else), checks after every download
  that the staged tarball is the one the pack job kept (its sha256), writes `SHA256SUMS` and the notes (the version's CHANGELOG section), and shows them all in the run summary
  with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, the tarball is the one the pack job kept (its sha256),
every native file is the one the release commit's `manifest/native.json` pins, size and sha256, with each gzip holding
the pinned executable, and the conformance report is ok for this version. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/we-the-rebel-alliance/linear-plugin/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
an app that installs only a published Release whose `SHA256SUMS` it verifies is protected. But a user who installs
`github:we-the-rebel-alliance/linear-plugin#v<version>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/check-drift.mjs`, `scripts/capture-tools.mjs`,
`scripts/release-kit.test.mjs`, `scripts/drift-kit.test.mjs` and `.github/workflows/release.yml`. `scripts/check-copies.mjs`
pins each of the scripts whole by its sha256, so a plugin whose copy differs from the family's fails `npm run check`:
change the kit in every plugin at once, with the new hashes. Do not re-run the older `apply-release-kit.mjs`: it writes
back the kit that could release only `v0.0.0`.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:we-the-rebel-alliance/linear-plugin#v<old version>`, then add the new tag with `opencode plugin add github:we-the-rebel-alliance/linear-plugin#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:we-the-rebel-alliance/linear-plugin#v<version>" }] }
```
