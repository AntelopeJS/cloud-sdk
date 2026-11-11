# `@antelopejs/cloud` CLI

`ajs-cloud` deploys a folder to AntelopeJS Cloud and operates it: log in once,
run `ajs-cloud deploy`, and get a public URL.

## Install

Node.js 20.19 or later is required. The CLI prints through the output module
of AntelopeJS core (`@antelopejs/core/cli`), a peer dependency that npm and
pnpm install with it.

```sh
npm install -g @antelopejs/cloud
# or
pnpm add -g @antelopejs/cloud

ajs-cloud --version
```

To run it without installing, `npx` fetches the latest version on each call:

```sh
npx @antelopejs/cloud login
npx @antelopejs/cloud deploy
```

The binary is `ajs-cloud`. The package also exports a Commander command
factory, meant to be mounted as `ajs cloud` by `@antelopejs/core`:

```ts
import { mountCloudCommand } from "@antelopejs/cloud/command";

mountCloudCommand(ajsProgram);
```

Released versions of core (1.4, 1.5) build the `ajs` command tree statically
and do not mount it yet: use `ajs-cloud` directly.

## Quick start

```sh
ajs-cloud login         # approve the login in your browser
cd my-app
ajs-cloud deploy        # first deploy: creates the project and its service
ajs-cloud status
ajs-cloud logs web
```

## Commands

| Command | What it does |
|---|---|
| `login` | Logs in with your browser (device flow), saves the session and names the workspace you approved it for |
| `logout` | Forgets the session saved on this machine |
| `whoami` | Shows the workspace, API and console you are logged in to, and checks the session is still accepted |
| `deploy [service]` | Deploys the linked services, or creates the project on a first deploy |
| `link <project>` | Links this folder to an existing project |
| `status` | Shows each service's state, any deployment in progress, and its URL |
| `open [service]` | Opens the project in the console, or a service's public URL |
| `logs <service>` | Prints the service's recent logs (last hour); `-f` follows them |
| `rollback <service> [revision]` | Rolls a service back to its previous revision, or to the given one |

`ajs-cloud --help` and `ajs-cloud <command> --help` list every option, with
examples.

```sh
ajs-cloud link my-project --service api=apps/api --service app=apps/app
ajs-cloud link my-project --service web=. --service frontend=. --dockerfile frontend=frontend.Dockerfile  # two services of one folder
ajs-cloud deploy        # all services from the project root
ajs-cloud deploy api    # one named service
cd apps/app && ajs-cloud deploy # inferred from the configured path
ajs-cloud logs api -f
ajs-cloud open [api]
ajs-cloud rollback api [revision-id]
```

### First deploy

In a folder that is not linked yet, `ajs-cloud deploy` creates what it needs
instead of failing:

1. It checks that your workspace can deploy. A new workspace takes about a
   minute to be prepared: `deploy` waits for it (up to three minutes) with a
   message, and explains a workspace that needs attention. Nothing is created
   before the workspace is ready.
2. It proposes a project named after the folder, the region (asked only when
   the platform offers several), a production service named `web` (or the
   `[service]` argument) and its port — read from a Dockerfile `EXPOSE`, an
   explicit `--port`/`PORT=` in the `start`, `serve` or `preview` script, or a
   known framework default, else `3000`. The platform passes the service's
   port to the app as `PORT`.
3. It prints the plan — project, region, `production` environment, service,
   source (an upload of the folder) and the monthly cost ceiling when the
   service already exists — and asks for confirmation.
4. It creates the project and a public upload service, writes
   `.antelope/cloud.json` exactly as `link` does, then uploads and follows the
   deployment like any later `deploy`.

A folder deploys when its root holds a `Dockerfile`, an `antelope.config.*`
(AntelopeJS project) or a `package.json` (Node app started by its `start`
script). `deploy` refuses any other folder before creating anything; the API
then decides, and explains a refusal — a missing `start` script, a monorepo,
an unsupported Node.js version, a source too large — with its fix.

When a project with that name is already visible, `deploy` offers to deploy to
it (creating the service there if it is missing) or proposes the next free
name. A name held by a project outside your scope is answered the same way.
The cost ceiling of a new service is printed right after it is created: rates
are read from the service, so there is none to show before it exists.

`--yes` (CI) never prompts: it uses the defaults and `--project`, `--region`,
`--port` when given, and stops without creating anything when the default name
is taken, invalid, or not allowed. Without `--yes` and without a terminal to
ask on, `deploy` stops before any write with exit code 2 and names the flags
to pass:

```sh
ajs-cloud deploy --yes --project my-app --port 8080
```

A project named with `--project` that already exists is deployed to as-is.
To deploy to an existing project with a custom service layout, use `link`
first.

A folder inside a linked one deploys with that link: the service whose path
holds it. Name `--project` there to deploy the folder as its own service
instead. The first deploy creates the service and links the folder, and later
deploys from it use its own link. Leave the folder out of the parent's upload
with a `.cloudignore`:

```sh
cd frontend && ajs-cloud deploy frontend --yes --project my-app --port 3000
```

### Following a deployment

`deploy` prints each phase with the elapsed time — `uploading`, `queued` (with
the queue position), `building` (with the build step), `rolling out`, `live` —
and ends with the total time and the public URL:

```
ℹ web: uploading · 0s
ℹ web: queued · 0s
ℹ web: building · 12s
ℹ web: rolling out · 1m 04s
ℹ web: live · 1m 31s
Deployed web · 1m 31s

Next steps
  ajs-cloud status       check where it is
  ajs-cloud logs web -f  read the service logs
https://my-app.antelopejs.io
```

The progress and the summary go to stderr; the public URL is the result, on
stdout, so `URL=$(ajs-cloud deploy -q)` captures it.

A new service's address is `<project>-<service>.antelopejs.io`, without
repeating what the project name already says: a service named `web`, `app` or
`www` gets `<project>.antelopejs.io`, and `shop` + `shop-admin` gives
`shop-admin.antelopejs.io`. A pull request preview is
`pr-<number>--<service address>.antelopejs.io`. Addresses are kept once given,
and longer ones are shortened to 40 characters with a stable suffix.

`live` is printed when the deployment succeeds, not when its build does: once
built, the new version stays `rolling out` while the platform applies and
health-checks it.

On a terminal a spinner on stderr shows the current phase. When stderr is not a
terminal (CI logs, a pipe), the output is plain lines with no control codes,
and a quiet phase is reported every 30 seconds
(`web: still building · 2m 30s`).

- **Timeout:** `deploy` stops following a deployment after 20 minutes
  (`--timeout <minutes>` to change it). The deployment itself keeps running:
  the command prints its console page and exits with an error.
- **Ctrl+C** stops the CLI, not the deployment, and exits with code 130. The
  CLI says so and prints how to follow it: `ajs-cloud status`,
  `ajs-cloud logs <service> -f`, and the deployment's console page.
- `status` shows a deployment still on its way, for example
  `web  deploying (queued, position in queue: 1)` while it builds, or
  `web  deploying (rolling out)` once it is built.

## Output, languages and errors

`ajs-cloud` follows the output contract of `ajs` and its plugins:

- **stdout carries results only**: tables (`status`), key/value lines
  (`whoami`), log lines, URLs (`open`, `deploy`), help and `--version`.
  Everything else (progress, warnings, errors, summaries, next steps) goes to
  stderr, so a result can be piped or captured.
- **Exit codes**: `0` success, `1` failure, `2` usage error (unknown command or
  option, invalid value, a question nobody can answer), `130` cancelled
  (Ctrl+C).
- **Errors** are printed once, as what failed, why, and how to fix it:

  ```
  ✖ You are not logged in
    → Run ajs-cloud login, then run the command again
  ```

  `--verbose` adds the stack trace of the underlying failure.
- **Prompts** only appear on an interactive terminal. Without one (a pipe, CI),
  a command that would ask fails with exit code 2 and names the flags that
  answer it, such as `--yes`.
- **Global options**, before or after the command: `--json` (`-j`), `--yes`
  (`-y`), `--no-browser`, `--lang en|fr`, `--api-url`, `-q`/`--quiet` (results,
  warnings and errors only), `--verbose[=channels]` and `--no-color`. They read
  the same environment as `ajs`: `NO_COLOR`, `FORCE_COLOR`,
  `ANTELOPEJS_QUIET`, `ANTELOPEJS_VERBOSE` and `CI`. `ajs-cloud help
  environment` lists them.
- **Languages**: the messages of the Cloud CLI are in English or French
  (`--lang`, else `LANG`). The texts shared with `ajs` (usage errors, help
  headings, the missing-flag error) stay in English.
- **`--json`** emits versioned JSON Lines on stdout
  (`{"version":1,"type":"deploy_event","data":{…}}`) and one JSON error on
  stderr (`{"version":1,"type":"error","error":{"code","message","status"}}`).
  Scripts should match on `type` and `error.code`: codes are stable, messages
  are not. The access token is never printed.

`deploy --json` emits `deploy_started`, one `deploy_event` per progress event
from the API, then `deploy_succeeded` with `services`, `urls` and
`durationMs`. It can also emit `workspace_not_ready`/`workspace_ready`,
`deploy_failed`, `deploy_timeout` and `deploy_detached` (after Ctrl+C).

## Sessions and endpoints

Credentials are stored with mode `0600` under the XDG config directory
(`~/.config/antelopejs/cloud.json`). The project mapping is stored in
`.antelope/cloud.json`. `logout` removes the saved session from this machine;
the token itself stays valid until it expires or is revoked.

`--api-url` takes precedence over `ANTELOPE_CLOUD_URL`. Login uses that endpoint
and binds the saved session to it. Other commands use the saved endpoint when
neither is set. If an override differs from the saved endpoint, they stop before
any API request with `api_url_mismatch`; run `ajs-cloud login --api-url <url>`
to authenticate with the intended endpoint first. The CLI never moves the saved
token to the override endpoint.

Endpoint comparison normalizes URL host casing, default ports, and a trailing
slash, while preserving scheme and base path differences. For authenticated
commands, overrides must be HTTP(S) URLs without embedded credentials, query
strings, or fragments.

## Development

The API client is `@antelopejs/cloud-sdk`. The workspace's `pnpm-workspace.yaml`
links `../sdk` in place of the published package, and `pnpm run sdk` builds it.
`build` and `typecheck` run it first.

```sh
pnpm install     # from the repository root
pnpm run sdk     # before lint, which reads the SDK's types
pnpm test        # build, then node:test over test/
pnpm lint
pnpm typecheck
```

### Publishing

The package is published to the public npm registry as `@antelopejs/cloud`
(`publishConfig.access` is `public`) by the `Release public npm package`
workflow, with `package: cli`, after an `@antelopejs/cloud-sdk` version in the
range the CLI depends on is on npm.

`pnpm pack` shows what would be published: `dist/` (without source maps), this
README and `package.json`.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                 | Supported     | Tested with |
| ----------------------- | ------------- | ----------- |
| `@antelopejs/cloud-sdk` | `^0.1.0`      | `workspace` |
| `@antelopejs/core`      | `>=1.21.0 <2` | `1.21.2`    |

<!-- antelopejs-docs-compat:end -->
