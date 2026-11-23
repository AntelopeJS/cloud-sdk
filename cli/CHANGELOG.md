# Changelog


## v0.2.1

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-cli-v0.2.0...cloud-cli-v0.2.1)

### 🩹 Fixes

- **cli:** Depend on the workspace sdk as workspace:^ ([#34](https://github.com/AntelopeJS/cloud-sdk/pull/34))

### 📦 Build

- Move to @antelopejs/tooling-configs 0.8 and the three-tier CI ([#24](https://github.com/AntelopeJS/cloud-sdk/pull/24), [#25](https://github.com/AntelopeJS/cloud-sdk/pull/25))

### 🤖 CI

- Move to trunk-based CI on main with the merge queue ([#28](https://github.com/AntelopeJS/cloud-sdk/pull/28))
- Re-sync the AntelopeJS pack for the release app ([#32](https://github.com/AntelopeJS/cloud-sdk/pull/32))
- Stop forwarding the retired RELEASE_GITHUB_TOKEN ([#33](https://github.com/AntelopeJS/cloud-sdk/pull/33))

### ❤️ Contributors

- Antony Rizzitelli

## v0.2.0

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-cli-v0.1.2...v0.2.0)

### 🩹 Fixes

- **release:** Resync the cli README in the sdk release commit ([#19](https://github.com/AntelopeJS/cloud-sdk/pull/19))
- **cli:** Accept @antelopejs/core 1.24 ([#22](https://github.com/AntelopeJS/cloud-sdk/pull/22))

### 🤖 CI

- Opt out of Windows jobs in ci-node.yml ([#20](https://github.com/AntelopeJS/cloud-sdk/pull/20))
- Run the Windows jobs again ([#21](https://github.com/AntelopeJS/cloud-sdk/pull/21))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.2

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-cli-v0.1.1...v0.1.2)

### 🚀 Enhancements

- **sdk:** List a project's deployments and what each revision built ([#2](https://github.com/AntelopeJS/cloud-sdk/pull/2))
- **sdk:** Create a project from a repository and wait out a refused stream ([#4](https://github.com/AntelopeJS/cloud-sdk/pull/4))
- **cli:** Name the command `ajs cloud` in hints, help and docs ([#7](https://github.com/AntelopeJS/cloud-sdk/pull/7))
- **sdk:** Send an Idempotency-Key with a project create ([#9](https://github.com/AntelopeJS/cloud-sdk/pull/9))
- **sdk:** Set a service's port and exposure, and follow a published value ([#10](https://github.com/AntelopeJS/cloud-sdk/pull/10))
- **sdk:** Read the log of a build ([#11](https://github.com/AntelopeJS/cloud-sdk/pull/11))
- **sdk:** Create a service built from a repository, with the Dockerfile that builds it ([#12](https://github.com/AntelopeJS/cloud-sdk/pull/12))

### 🩹 Fixes

- **cli:** Keep a service's Dockerfile inside its folder, and bound the SSE frame buffer ([#6](https://github.com/AntelopeJS/cloud-sdk/pull/6))
- **checks:** Run check:generated from checks:prepare ([#8](https://github.com/AntelopeJS/cloud-sdk/pull/8))
- **license:** Ship the Apache-2.0 LICENSE in both npm tarballs ([#16](https://github.com/AntelopeJS/cloud-sdk/pull/16))

### 💅 Refactors

- Bring suppressions and lint debt to zero ([#15](https://github.com/AntelopeJS/cloud-sdk/pull/15))

### 📖 Documentation

- **readme:** Adopt the AntelopeJS framework README style ([#13](https://github.com/AntelopeJS/cloud-sdk/pull/13))
- **license:** Add the Apache-2.0 LICENSE and link the README to it ([#14](https://github.com/AntelopeJS/cloud-sdk/pull/14))
- **cli:** Sync the compatibility table to cloud-sdk 0.1.6 ([#18](https://github.com/AntelopeJS/cloud-sdk/pull/18))

### 📦 Build

- **deps:** Move to tooling-configs 0.6.0 and cap the @antelopejs ranges ([#17](https://github.com/AntelopeJS/cloud-sdk/pull/17))

### 🏡 Chore

- **release:** @antelopejs/cloud-sdk v0.1.2 ([e9cb5c6](https://github.com/AntelopeJS/cloud-sdk/commit/e9cb5c6))
- Onboard the AntelopeJS guardrail pack with antelopejs-sync --init ([#5](https://github.com/AntelopeJS/cloud-sdk/pull/5))
- **release:** @antelopejs/cloud-sdk v0.1.3 ([2453e7e](https://github.com/AntelopeJS/cloud-sdk/commit/2453e7e))
- **release:** @antelopejs/cloud-sdk v0.1.4 ([044d239](https://github.com/AntelopeJS/cloud-sdk/commit/044d239))
- **release:** @antelopejs/cloud-sdk v0.1.5 ([42feee2](https://github.com/AntelopeJS/cloud-sdk/commit/42feee2))
- **release:** @antelopejs/cloud-sdk v0.1.6 ([d924878](https://github.com/AntelopeJS/cloud-sdk/commit/d924878))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Dada-sudo <damir@altab.be>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-cli-v0.1.0...v0.1.1)

### 🏡 Chore

- **release:** Sync sdk and cli to the published 0.1.0 ([#3](https://github.com/AntelopeJS/cloud-sdk/pull/3))
- **release:** @antelopejs/cloud-sdk v0.1.1 ([a2b61d2](https://github.com/AntelopeJS/cloud-sdk/commit/a2b61d2))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

