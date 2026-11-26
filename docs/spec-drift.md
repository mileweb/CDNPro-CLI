# Spec drift workflow

How to find out what changed in the CDN Pro API spec, decide what the CLI must do about it, and update the pinned baseline. Written for coding agents and maintainers.

## Artifacts

| Artifact | Committed | Role |
|---|---|---|
| `openapi.lock.json` | yes | **The baseline.** Pins the `docs-content-cdn` commit, sha256, and shape of the spec the CLI code is based on. |
| `openapi.json` | no (gitignored) | A disposable, hash-verified copy of the pinned spec. `npm run build` installs it. Never edit it. |
| `src/types/api.ts` | yes (generated) | `openapi-typescript` output for the pinned spec. Never edit it. |
| `docs/spec-drift.md` | yes | This guide. |

The division of labour is deliberate:

- **oasdiff enumerates** every structural change. It is reliable and complete; use it for nothing else.
- **The agent decides** what each change means for the CLI, using the code and the invariants below.
- **Tests are the arbiter.** `tsc`, `mapping-audit`, and the weekly staging/prod regression decide whether the change is really handled.

A grade-A ledger accounts for every oasdiff entry. Nothing is silently skipped.

## Non-negotiables

1. **Fetch candidates fresh.** Never diff against a local docs clone or a cached file; live `dev` has been several changes ahead of local refs. The wrapper resolves remote refs and downloads by immutable SHA.
2. **Never classify in the tooling.** `spec-diff` only fetches and invokes oasdiff. If you find yourself adding severity or "required change" logic to it, stop.
3. **Never hand-edit** `openapi.json` or `src/types/api.ts`.
4. **Advance the lock only after the code and tests are ready**, in the same commit as the code and regenerated types.
5. **Release only from a `master`-derived lock.** A `dev` pin is for preparing a change on a branch. `openapi.json` drives *runtime* request validation, so a spec ahead of production can reject valid production requests. `npm run spec:check --release` (run automatically by `prepublishOnly`) warns when the lock's sha256 differs from live `master`.

## Prerequisites

oasdiff is an external Go binary, version **1.41.0**. It is deliberately not an npm dependency; the npm package named `oasdiff` is unrelated.

```bash
# Pick one:
#   download the release binary (Windows/macOS/Linux, amd64/arm64)
#   https://github.com/oasdiff/oasdiff/releases/tag/v1.41.0
#   go install github.com/oasdiff/oasdiff@v1.41.0
#   brew install oasdiff
#   docker run --rm tufin/oasdiff ...

oasdiff --version        # expect 1.41.x
export OASDIFF_BIN=/path/to/oasdiff    # optional if it is not on PATH
```

`spec-diff` fails before any network work if oasdiff is missing or older than 1.41.

## The loop

```bash
# 1. Enumerate changes against the pinned baseline (live docs ref).
npm run spec:diff -- --from dev
npm run spec:diff -- --from dev --format markdown    # human-readable
npm run spec:diff -- --from master --fail-on ERR     # exit 1 if any ERR

# Ad-hoc candidates:
npm run spec:diff -- --from ./candidate.json
npm run spec:diff -- --from https://…/openapi.json
npm run spec:diff -- --from 647ad2417e201d8fae8840307726fbf3fbf15000
```

`stdout` is exactly oasdiff's output. Provenance goes to `stderr` (baseline commit/sha, candidate ref → commit/sha, oasdiff version).

```bash
# 2. Decide what to change, fill in the ledger (below), edit code/tests.

# 3. Adopt the new spec deliberately. This downloads, verifies, writes
#    openapi.json + openapi.lock.json, and regenerates src/types/api.ts.
npm run spec:update -- --from dev
npm run spec:update -- --from master      # production promotion / re-pin
npm run spec:update -- --from <40-hex>    # exact commit
npm run spec:update -- --from dev --dry-run   # print the lock, write nothing

# 4. Build and test against the newly pinned spec.
npm run build
npm test

# 5. Commit openapi.lock.json + src/types/api.ts + code + tests together.
```

Useful checks:

```bash
npm run spec:check                 # offline: does openapi.json match the lock?
npm run spec:check -- --release    # warn if the lock is not live master (prepublishOnly)
npm run fetch:spec                 # install the pinned spec (no network if it matches)
npm run fetch:spec -- --force      # re-download the pinned spec
```

`OPENAPI_SPEC_URL` still works as a warned, unpinned escape hatch. It bypasses the lock and cannot be used with `--check`/`--release`.

## Reading oasdiff output

The default `--format json` is an array of entries:

| Field | Meaning |
|---|---|
| `fingerprint` | Stable ID for this change *while the baseline is fixed*. Use it as the ledger row ID. |
| `id` | Change kind, e.g. `new-optional-request-parameter`, `response-required-property-removed`. |
| `level` | `1` = INFO, `2` = WARN, `3` = ERR. |
| `operation`, `operationId` | HTTP method and operation, e.g. `GET` / `get-cdn-report-cpuSummary`. **Check this** — a path can have several methods. |
| `path` | API path. |
| `text` | Human-readable description. |
| `section` | `paths` or `components`. |
| `baseSource` / `revisionSource` | File, line, column in each document. |

**Levels are API-contract severity, not CLI impact.** Real examples from a run:

- `ERR` `response-property-enum-value-added` on `edgeHostnames` history → **no CLI change**: the CLI prints responses and never validates response enums.
- `ERR` `response-required-property-removed` for `webooks` → **no CLI change**: a docs typo, corrected in the same revision to `webhooks`; `buildMeta` finds the single top-level array dynamically.
- `INFO` `new-optional-request-parameter` `status` on `GET /cdn/edgeHostnames` → **requires a flag**, because every declared query/header parameter must have one.
- `WARN` `request-parameter-removed` `groupby` on `GET /cdn/report/cpuSummary` → **no CLI change**: the mapped operation is the POST, whose body still has `groupBy`.

Do not use `oasdiff summary` or `oasdiff diff` as the change list. `summary` counts documentation edits (a real run showed "90 endpoints modified" for 16 consumer-relevant changes), and `diff` includes every description tweak (237 KB / 630 leaves in that run). `changelog` is the only input.

Because the spec is fully dereferenced, one logical schema change can surface once per operation, with distinct fingerprints. Do not dedupe in the wrapper; group related rows in the ledger.

## Project invariants

Every mapped operation follows these rules; `src/test/mapping-audit.test.ts` enforces most of them:

- Every declared query or header parameter has an `OptionMapping` flag (`On-Behalf-Of` is the global `--on-behalf-of` exception).
- Required query parameters are marked `required: true` in the mapping.
- Every body-mapped flag targets a property that exists in the request schema (dot paths descend through arrays).
- List responses expose one top-level item array (except the documented merged IP lists).
- A new/removed operation touches `OPERATION_MAP` in `src/schema/query.ts`, its command file under `src/cli/commands/`, and (for a new group) `registerAllCommands` in `src/cli/register-commands.ts`.
- Enum/format changes flow through `findOptionViolations` in `src/cli/option-map.ts`; `format: date-time` is enforced by `src/schema/date-time.ts`.
- Response-shape changes can affect list extraction (`buildMeta` in `src/cli/output.ts`), pagination (`src/cli/paginate.ts`), `wait` (`src/cli/wait.ts`), and the human output of report/purge commands.

Where to look for a changed operation:

1. `src/schema/query.ts` — is it mapped at all?
2. `src/cli/commands/<resource>/` — the command and its `OptionMapping[]`.
3. `src/cli/option-map.ts` — shared presets, validation, mapping registration.
4. `src/schema/loader.ts` / `validate.ts` / `synthesize.ts` — runtime schema use.
5. `src/test/mapping-audit.test.ts`, `report-options.test.ts`, `enum-validation.test.ts` — the existing expectations.

## Ledger template

Write the ledger to `docs/internal/spec-drift-<YYYY-MM-DD>.md` (gitignored) and paste it into the PR.

```markdown
# Spec drift ledger — <candidate> → <commit> — <date>

- Baseline (lock): <commit> / sha256 <…>
- Candidate: <ref|url|file> → <commit> / sha256 <…>
- oasdiff: <version>, changelog --format json
- Counts: ERR <n>, WARN <n>, INFO <n>

| # | fingerprint | level | id | method path | CLI surface | decision | notes / evidence |
|---|---|---|---|---|---|---|---|
| 1 | b31af7a6296c | ERR | response-property-enum-value-added | GET /cdn/edgeHostnames/{edgeHostname} | edge-hostname get | no-cli-impact | response enums are not validated |
```

Decision vocabulary: `no-cli-impact`, `types-only`, `flag-added`, `behavior-change`, `follow-up`, `blocked`.

Definition of done: every fingerprint has a row and a decision; code/tests reflect the `flag-added`/`behavior-change` rows; `npm test` passes; the lock is advanced only when the changes are ready.

## Worked example

A real `npm run spec:diff -- --from dev` against the initial lock (`647ad24`, sha256 `c95812a9…`) produced 16 entries: 4 ERR, 1 WARN, 11 INFO. The dev candidate was `d0aca9e0` (87 paths, 144 operations).

| fingerprint | level | change | decision |
|---|---|---|---|
| `b31af7a6296c` | ERR | `edgeHostnames` history enum gains `delete` | no-cli-impact |
| `b16d9e8fb81a` | ERR | `originStatusSummary` `enddate` format → `date-time` | behavior-change (`--to` now RFC 3339) |
| `051e1033137a` | ERR | `originStatusSummary` `startdate` format → `date-time` | behavior-change (`--from` now RFC 3339) |
| `055ce660c91b` | ERR | `GET /cdn/webhooks` loses required `webooks` | no-cli-impact (typo; paired with `webhooks` below) |
| `c0ae77b9b813` | WARN | `GET /cdn/report/cpuSummary` loses `groupby` | no-cli-impact (GET not exposed; POST body unchanged) |
| `40d97b30041a` | INFO | `GET /cdn/edgeHostnames` gains `status` | **flag-added** — add `--status` to `edge-hostname list` |
| `1ecb97590367` | INFO | `edgeHostnames` items gain `status` | no-cli-impact |
| `740d880a8d9a` | INFO | `edgeHostnames/{id}` gains `status` | no-cli-impact |
| `503b3b3b3dc9` | INFO | `edgeHostnames` history enum loses `deletion` | no-cli-impact |
| `db46a4a95ec6` | INFO | `purgeTokens` `target` becomes optional | no-cli-impact (`--target` was never required) |
| `2b9982e9e95f` | INFO | endpoint added: `POST /cdn/report/avgEdgeRtt` | follow-up (required `type`, `startdate`, `enddate`) |
| `4810e5ad26c4` | INFO | `GET /cdn/report/cpuSummary` gains `groupBy` | no-cli-impact (GET not exposed) |
| `015b1e93c4a3` | INFO | `GET /cdn/webhooks` gains required `webhooks` | no-cli-impact (typo fix) |
| `a5d47cc4c481` | INFO | webhook metaData gains `lastDurationInSec` | no-cli-impact |
| `d110e933bcaa` | INFO | webhook metaData gains `lastStatus` | no-cli-impact |
| `849e17a68120` | INFO | `PATCH /cdn/webhooks/{id}` gains a 400 response | no-cli-impact |

Net: 1 flag addition, 2 behavior changes, 1 follow-up, 12 no-impact. That is the normal shape — the evaluator is the agent, not the severity label.

## Release ordering

1. Prepare on a branch: `spec:update -- --from dev`, adapt code, test against staging.
2. Do **not** publish the npm package yet. Runtime validation uses the pinned spec.
3. After the API reaches production, `spec:update -- --from master` (or confirm the content is identical) and release.
4. `prepublishOnly` runs `spec:check --release`; it warns if the lock's sha256 differs from live `master`. Treat that warning as a stop sign.

## Troubleshooting

- **oasdiff missing/old** — install v1.41.0; set `OASDIFF_BIN`. The wrapper refuses versions < 1.41 or a non-1.x major.
- **Ref resolution fails or is rate-limited** — the tool tries the GitHub API first, then `git ls-remote`. Set `GITHUB_TOKEN`/`GH_TOKEN`, or pass a full commit SHA.
- **`openapi.json` hash mismatch** — `npm run spec:check` shows expected vs actual. Recover with `npm run fetch:spec -- --force`, or restore the intended lock.
- **Offline build** — works if `openapi.json` matches the lock. If it is missing or mismatched, the build fails rather than using an unverified file.
- **Duplicate-looking entries** — expected with a fully dereferenced spec; group them in the ledger.
- **Local docs clone disagrees with the remote** — irrelevant; the tooling resolves refs remotely and downloads by SHA. Do not use local refs.