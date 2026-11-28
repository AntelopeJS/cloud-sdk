# Changelog


## v0.1.9

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.8...cloud-sdk-v0.1.9)

### 🚀 Enhancements

- **sdk:** Read and choose the maintenance window of a managed database in the spec, the SDK and the CLI (ANT-810) ([#50](https://github.com/AntelopeJS/cloud-sdk/pull/50))
- **sdk:** Attach a volume to a service and read its volumes (W1941e8b4-2) ([#52](https://github.com/AntelopeJS/cloud-sdk/pull/52))

### 📦 Build

- **deps:** Move CI runners to free GitHub runners for public repos (tooling-configs 0.10.15) ([#51](https://github.com/AntelopeJS/cloud-sdk/pull/51))

### ❤️ Contributors

- dada-sudo
- Antony Rizzitelli

## v0.1.8

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.7...cloud-sdk-v0.1.8)

### 🚀 Enhancements

- **sdk:** Name the root folder and shared paths of a repository service in the spec, the SDK and the CLI (ANT-745) ([#47](https://github.com/AntelopeJS/cloud-sdk/pull/47))
- **sdk:** Name the build-time mark of a variable in the spec, the SDK and an env command of the CLI (ANT-746) ([#49](https://github.com/AntelopeJS/cloud-sdk/pull/49))

### 📖 Documentation

- **sdk:** Document the SDK features merged in November ([#35](https://github.com/AntelopeJS/cloud-sdk/pull/35))
- **sdk:** Correct the port and exposure claims in the README ([#38](https://github.com/AntelopeJS/cloud-sdk/pull/38))

### 📦 Build

- **deps:** Move @antelopejs/tooling-configs to 0.10.14 and sync ([#48](https://github.com/AntelopeJS/cloud-sdk/pull/48))

### 🏡 Chore

- **deps:** Move to tooling-configs 0.10.7 and pnpm 10.34.9 with a 24h release age ([#41](https://github.com/AntelopeJS/cloud-sdk/pull/41))
- **deps:** Update antelopejs tooling configs ([#42](https://github.com/AntelopeJS/cloud-sdk/pull/42))
- **ci:** Bring CI to the org conventions with tooling-configs 0.10.12 and a verification skill ([#44](https://github.com/AntelopeJS/cloud-sdk/pull/44))

### 🤖 CI

- Re-sync the AntelopeJS pack for the release app ([#32](https://github.com/AntelopeJS/cloud-sdk/pull/32))
- Stop forwarding the retired RELEASE_GITHUB_TOKEN ([#33](https://github.com/AntelopeJS/cloud-sdk/pull/33))

### ❤️ Contributors

- Antony Rizzitelli
- dada-sudo

## v0.1.7

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.6...cloud-sdk-v0.1.7)

### 🩹 Fixes

- **release:** Resync the cli README in the sdk release commit ([#19](https://github.com/AntelopeJS/cloud-sdk/pull/19))

### 📦 Build

- Move to @antelopejs/tooling-configs 0.8 and the three-tier CI ([#24](https://github.com/AntelopeJS/cloud-sdk/pull/24), [#25](https://github.com/AntelopeJS/cloud-sdk/pull/25))

### 🤖 CI

- Move to trunk-based CI on main with the merge queue ([#28](https://github.com/AntelopeJS/cloud-sdk/pull/28))

### ❤️ Contributors

- Antony Rizzitelli

## v0.1.6

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.5...v0.1.6)

### 🩹 Fixes

- **license:** Ship the Apache-2.0 LICENSE in both npm tarballs ([#16](https://github.com/AntelopeJS/cloud-sdk/pull/16))

### 💅 Refactors

- Bring suppressions and lint debt to zero ([#15](https://github.com/AntelopeJS/cloud-sdk/pull/15))

### 📖 Documentation

- **license:** Add the Apache-2.0 LICENSE and link the README to it ([#14](https://github.com/AntelopeJS/cloud-sdk/pull/14))

### 📦 Build

- **deps:** Move to tooling-configs 0.6.0 and cap the @antelopejs ranges ([#17](https://github.com/AntelopeJS/cloud-sdk/pull/17))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.5

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.4...v0.1.5)

### 🚀 Enhancements

- **sdk:** Read the log of a build ([#11](https://github.com/AntelopeJS/cloud-sdk/pull/11))
- **sdk:** Create a service built from a repository, with the Dockerfile that builds it ([#12](https://github.com/AntelopeJS/cloud-sdk/pull/12))

### 📖 Documentation

- **readme:** Adopt the AntelopeJS framework README style ([#13](https://github.com/AntelopeJS/cloud-sdk/pull/13))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Dada-sudo <damir@altab.be>

## v0.1.4

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.3...v0.1.4)

### 🚀 Enhancements

- **sdk:** Set a service's port and exposure, and follow a published value ([#10](https://github.com/AntelopeJS/cloud-sdk/pull/10))

### ❤️ Contributors

- Dada-sudo <damir@altab.be>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.2...v0.1.3)

### 🚀 Enhancements

- **cli:** Name the command `ajs cloud` in hints, help and docs ([#7](https://github.com/AntelopeJS/cloud-sdk/pull/7))
- **sdk:** Send an Idempotency-Key with a project create ([#9](https://github.com/AntelopeJS/cloud-sdk/pull/9))

### 🩹 Fixes

- **cli:** Keep a service's Dockerfile inside its folder, and bound the SSE frame buffer ([#6](https://github.com/AntelopeJS/cloud-sdk/pull/6))
- **checks:** Run check:generated from checks:prepare ([#8](https://github.com/AntelopeJS/cloud-sdk/pull/8))

### 🏡 Chore

- Onboard the AntelopeJS guardrail pack with antelopejs-sync --init ([#5](https://github.com/AntelopeJS/cloud-sdk/pull/5))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))
- Dada-sudo <damir@altab.be>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.1...v0.1.2)

### 🚀 Enhancements

- **sdk:** List a project's deployments and what each revision built ([#2](https://github.com/AntelopeJS/cloud-sdk/pull/2))
- **sdk:** Create a project from a repository and wait out a refused stream ([#4](https://github.com/AntelopeJS/cloud-sdk/pull/4))

### 🏡 Chore

- **release:** @antelopejs/cloud v0.1.1 ([725462e](https://github.com/AntelopeJS/cloud-sdk/commit/725462e))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

## v0.1.1

[compare changes](https://github.com/AntelopeJS/cloud-sdk/compare/cloud-sdk-v0.1.0...v0.1.1)

### 🏡 Chore

- **release:** Sync sdk and cli to the published 0.1.0 ([#3](https://github.com/AntelopeJS/cloud-sdk/pull/3))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](http://github.com/Upd4ting))

