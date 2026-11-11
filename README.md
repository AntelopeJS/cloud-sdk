# AntelopeJS Cloud SDK and CLI

This repository holds the two public npm packages of AntelopeJS Cloud:

- `@antelopejs/cloud-sdk` in [`sdk/`](sdk/README.md) is a typed client for the AntelopeJS Cloud API. Its types are generated from the OpenAPI spec in `sdk/openapi/`, which the package also ships.
- `@antelopejs/cloud` in [`cli/`](cli/README.md) is the `ajs-cloud` command-line client. It deploys a folder to AntelopeJS Cloud and operates it, through the SDK.

Both need Node.js 20.19 or later.

## Install

Install the CLI globally to get the `ajs-cloud` command:

```sh
npm install -g @antelopejs/cloud
```

Add the SDK to a project that calls the API from code:

```sh
npm install @antelopejs/cloud-sdk
```

## Use the CLI

Log in once, then deploy from the folder of your app:

```sh
ajs-cloud login
cd my-app
ajs-cloud deploy
ajs-cloud status
```

The first `deploy` creates the project and its service, then prints the public URL. The [CLI README](cli/README.md) lists every command and option.

## Use the SDK

```ts
import { CloudApi, CloudApiError } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
try {
	console.log(await api.listProjects());
} catch (error) {
	if (error instanceof CloudApiError) console.error(error.status, error.code);
}
```

The [SDK README](sdk/README.md) covers device login, errors, and the generated types.

## Point at another API

Both packages talk to the production API, `https://api.antelopejs.cloud`, by default. Neither package ships another address.

To reach another deployment of the API from the SDK, pass its origin as `baseUrl`:

```ts fragment
const api = new CloudApi({ token, baseUrl: "https://api.example.test" });
```

To reach it from the CLI, pass `--api-url` or set `ANTELOPE_CLOUD_URL`. The flag wins over the variable. Log in against that API first, because a saved session belongs to the API it was opened on:

```sh
ajs-cloud login --api-url https://api.example.test
ANTELOPE_CLOUD_URL=https://api.example.test ajs-cloud status
```

A command whose API differs from the one of the saved session stops before any request, with the error code `api_url_mismatch`.

## Develop

The repository is a pnpm workspace. The CLI builds and tests against the SDK in `sdk/`, not against the version published on npm.

```sh
pnpm install
pnpm run checks
pnpm run check:hosts
```

`pnpm run checks` runs lint, the format check, typecheck, `check:generated`, and the tests of both packages and of `scripts/`. `check:generated` regenerates `sdk/src/generated/cloud-api.ts` from the spec and fails if the committed file differs. After you change the spec, run `pnpm --dir sdk run generate` and commit the result.

`pnpm run check:hosts` keeps private deployments out of this public repository:

- `scripts/check-package-hosts.mjs` packs `sdk` and `cli` as `npm publish` would. It fails when a packed file says `staging` or names a host other than the production API, the app domain `antelopejs.io`, `github.com`, `registry.npmjs.org`, or a reserved documentation name such as `example.test`.
- `scripts/check-repository-hosts.mjs` reads every tracked file, every line a commit added, and every commit message. It fails on a host of ours other than the production ones, a host whose name says staging, or a private-network host. It reads a host from a URL, from a name under an `antelopejs` domain, and from a private address or cluster name written without a scheme. It needs the whole history and refuses a shallow clone.

CI runs both commands on every pull request and on every push to `main`.

## Release

The **Release public npm package** workflow publishes one package per run, from `main` for the `latest` channel or from `next` for the `next` channel. It publishes with npm provenance through the shared `release-npm-public.yml` workflow of `AntelopeJS/.github`.

Each package's changelog starts from that package's last tag. Before the first release, tag the first commit of `main` for both packages and push the tags:

```sh
git tag cloud-sdk-v0.0.0 "$(git rev-list --max-parents=0 origin/main)"
git tag cloud-cli-v0.0.0 "$(git rev-list --max-parents=0 origin/main)"
git push origin cloud-sdk-v0.0.0 cloud-cli-v0.0.0
```

The workflow fails before it publishes when the package has no tag. A package releases only when a commit since its last tag changed its directory.

The CLI depends on a range of SDK versions, so release in this order:

1. Run the workflow with `package: sdk`. The first SDK release sets `release-version` to `0.1.0`, the first version in the range that the CLI depends on.
2. Check that the new version of `@antelopejs/cloud-sdk` is on npm.
3. Run the workflow with `package: cli`. The first CLI release also sets `release-version` to `0.1.0`.

The CLI run fails before it publishes when no version of `@antelopejs/cloud-sdk` that matches its range is on npm. When a CLI change needs a new SDK release, raise the range in `cli/package.json` and release the SDK first.
