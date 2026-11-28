---
name: verify-cloud-sdk
description: How to check a change in the AntelopeJS cloud-sdk repository (the sdk/ and cli/ packages) before you push it, scoped to what you touched. Use after you edit sdk, cli, scripts, docs, config or workflows, before you commit or push.
---

# Verify a change in cloud-sdk

CI runs every check on every pull request and the merge queue runs them again on the merged result. You check only what you changed. This repo replaces the shared `verify-changes` skill: its packages test with `node --test` on a `tsc` build, not `ajs module test`.

## Setup

Once per checkout: `pnpm install`. Node 24 (`.nvmrc`), pnpm 10.34.9 (`packageManager`). Two packages: `sdk/` (`@antelopejs/cloud-sdk`) and `cli/` (`@antelopejs/cloud`, built on the sdk).

## What to run for your change

| You changed | Run |
| --- | --- |
| Any file | `pnpm exec oxlint <files>` and `pnpm exec oxfmt --check <files>` |
| A type, signature or export | `pnpm run typecheck` (both packages) |
| `sdk/openapi/cloud.openapi.yaml` or `sdk/src/generated/` | `pnpm run check:generated`, then the sdk test file that covers the endpoint |
| `sdk/src` or a test in `sdk/test` | `cd sdk && pnpm run build && pnpm exec rimraf dist-test && pnpm exec tsc -p test && node --test --test-concurrency=4 dist-test/test/<name>.test.js` |
| `cli/src` or a test in `cli/test` | `cd cli && pnpm run build && pnpm exec rimraf dist-test && pnpm exec tsc -p test && node --test --test-concurrency=4 dist-test/test/<name>.test.js` |
| `scripts/*.mjs` | `node --test --test-concurrency=4 scripts/<name>.test.mjs` |
| `package.json` hosts or repository URLs | `pnpm run check:hosts` |
| A lint directive, `@ts-expect-error` or `SAFETY:` comment | `pnpm run suppressions`; after removing one, `pnpm run suppressions:update` and commit `guardrails.suppressions.json` |
| A file `antelopejs-sync` writes (`.github/workflows/ci.yml`, `lefthook.yml`, the Guardrails block of `AGENTS.md`, `verify-changes`) | Nothing by hand: change `@antelopejs/tooling-configs`, then `pnpm run sync` and `pnpm run sync:check` |
| Markdown only | The lint and format row |

The `test` script of each package builds, then runs every suite: it is CI's, never run it whole. `cli` tests read the built `sdk`, which `pnpm run build` in `cli/` rebuilds first. Pass a single `<name>.test.js`, never a glob.

## Services

None: the tests start their own fixture server in process. No database, container or port to start or stop.

## Left to CI

Run by `.github/workflows/ci.yml`, job `ci` (the shared `ci-node.yml@v2`), with `verdict` gating the merge queue. Read its result on the pull request; do not run it locally.

- `pnpm run checks` (the full guardrails: lint, format, typecheck, knip, suppressions, sync, size) and the whole test suite of both packages.
- The Windows legs (`windows: true`, and `windows-merge-queue: true` for the queue).
- The nightly tier and Stress, from the `schedule` trigger.
- `check:hosts` after a full unshallow fetch, the docs check on `README.md`, `cli/README.md`, `sdk/README.md`, and the pull request title.
- Releases: `.github/workflows/release.yml`.

When CI reports a failure, reproduce that one test file with the row above, fix it and push.

## Done

The change is checked when every row its diff touches passed. Name each command you ran and its result in your reply or pull request, and say which checks you left to CI.
