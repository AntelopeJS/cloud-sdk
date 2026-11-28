# `@antelopejs/cloud-sdk`

A typed client for the AntelopeJS Cloud API: the client the `ajs cloud` CLI
uses, without the CLI. Its only runtime dependency is `openapi-fetch`.

## Install

Node.js 20.19 or later is required.

```sh
npm install @antelopejs/cloud-sdk
# or
pnpm add @antelopejs/cloud-sdk
```

## Client

```ts
import { CloudApi, CloudApiError } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
try {
  console.log(await api.listProjects());
} catch (error) {
  if (error instanceof CloudApiError) console.error(error.status, error.code);
}
```

The client talks to `https://api.antelopejs.cloud` (`DEFAULT_API_URL`). Pass
`baseUrl` to reach another deployment, and `fetch` to send the requests
yourself, such as through a proxy or a test double.

Every refusal is a `CloudApiError` with the HTTP `status`, the API's `code`,
the `params` its message interpolates, and `retryAfterS` when the API asked to
wait. An upload the API accepts with an answer that is not a deployment receipt
is an `InvalidApiResponseError`. `@antelopejs/cloud-sdk/errors` exports both
classes without loading the client.

## Device login

A device login (RFC 8628) gets a token without handling a password:

```ts
import { CloudApiError, createDevice, exchangeDevice } from "@antelopejs/cloud-sdk";

const PENDING = new Set(["authorization_pending", "slow_down"]);
const device = await createDevice("My tool");
console.log(`Approve ${device.user_code} at ${device.verification_uri_complete}`);
let token;
while (!token) {
  await new Promise((done) => setTimeout(done, device.interval * 1000));
  token = await exchangeDevice(device.device_code).catch((error) => {
    if (error instanceof CloudApiError && PENDING.has(error.code)) return undefined;
    throw error;
  });
}
```

Until a person approves the code, `exchangeDevice` refuses with
`authorization_pending`, or `slow_down` when polled too fast: RFC 8628 then
asks for five more seconds between polls. Both functions take the same
`baseUrl` and `fetch` options as the client.

## Create a project once

Pass an `idempotencyKey`, 1 to 255 visible ASCII characters, so that a retried create answers the project the first call made:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });

const project = await api.createProject(
  { slug: "shop" },
  { idempotencyKey: "shop-create-1" },
);
console.log(project);
```

The key is scoped to the workspace and to the member who sends it. The same key with another body is refused with `cloud.errors.projects.idempotency_key_reused`, and `cloud.errors.projects.creation_in_progress` asks for a retry with the same key.

## Create a service from a repository

A `repository` source builds a repository at each push to its branch, with the Dockerfile `dockerfilePath` names. Give the container's `port`, and set `isPublic` to serve it on its own address:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const projectId = "…";
const environmentId = "…";

const service = await api.createService(projectId, environmentId, {
  name: "dashboard",
  appName: "dashboard",
  source: {
    type: "repository",
    repository: "acme/shop",
    dockerfilePath: "frontend.Dockerfile",
  },
  port: 3000,
  isPublic: true,
});
console.log(service);
```

In a monorepo, `rootPath` names the folder the service builds from, and `sharedPaths` the paths outside it a push rebuilds the service for:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const projectId = "…";
const environmentId = "…";

await api.createService(projectId, environmentId, {
  name: "web",
  appName: "shop-web",
  source: {
    type: "repository",
    repository: "acme/shop",
    rootPath: "apps/web",
    sharedPaths: ["packages/ui", "pnpm-lock.yaml"],
  },
  port: 3000,
});
```

The build context holds the folder and nothing else, and the recipe reads the folder's `package.json`. A push rebuilds the service when it touches the folder, one of its shared paths or its Dockerfile, and leaves it alone otherwise. `dockerfilePath` stays relative to the repository, so `docker/web.Dockerfile` with the root folder `apps/web` builds the folder with a Dockerfile kept outside it. Every path is relative to the repository: letters, digits, `.`, `_` and `-`, separated by `/`, 255 characters at most, with no `.` or `..` segment. A service watches 20 shared paths at most.

## Change how a repository service builds

`setServiceDockerfile`, `setServiceRootPath` and `setServiceSharedPaths` each change one field: `null` goes back to the default, and an empty list clears the shared paths. `setServiceSource` writes the whole source in one call, to move a service to another repository or back to uploads. The next build reads the change, and the revisions already built keep their image:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const serviceId = "…";

await api.setServiceRootPath(serviceId, "apps/web"); // null: the repository root
await api.setServiceSharedPaths(serviceId, ["packages/ui"]); // []: none
await api.setServiceDockerfile(serviceId, "docker/web.Dockerfile");
await api.setServiceSource(serviceId, { type: "upload" });
```

A path that is not a plain relative path inside the repository is refused with `cloud.errors.settings.invalid_root_path`, `cloud.errors.settings.invalid_shared_paths` or `cloud.errors.settings.invalid_dockerfile_path`, and a service that builds no repository with `cloud.errors.settings.not_a_repository_source`. `serviceSettings` reads the three back in its `source`.

## Port and exposure

A service that a project creation builds from a repository starts without a port, and is refused its deployments until it has one; a service created with a port, like the `port: 3000` above, keeps it. Only the port setter waits for a deployment: the running revision keeps the port it was deployed with, and the next deployment takes the new one. `setServiceExposure` opens the service to the internet on its own address, or closes it:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const serviceId = "…";

await api.setServicePort(serviceId, 8080); // 1024 to 65535, or null to clear
await api.setServiceExposure(serviceId, true); // false closes it again
```

`setServiceExposure` refuses a service without a port with `cloud.errors.settings.public_needs_port`.

`attachServiceVolume` gives a service that has none a persistent volume, and `serviceSettings(serviceId)` lists the volumes a service has with the space each uses (`usedGb` is null when it could not be measured). A service holds one volume, and the service runs on one replica once it has one:

```ts
await api.attachServiceVolume(serviceId, {
  name: "data",
  mountPath: "/data",
  sizeGb: 5,
});
```

It refuses an invalid name, path or size with `cloud.errors.settings.invalid_volume` (400), a second volume with `cloud.errors.settings.volume_already_attached` (409), and a volume past the plan's count or size with a `cloud.errors.limits.*` code (409).

## Variables

`listVariables` lists the variables of every service of an environment, those wired from a resource included; a secret's `value` is always `null`. `setVariable` creates or changes one variable of a service: a new variable is a secret unless `secret` is `false`, and a held variable keeps its kind. `deleteVariable` removes one:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const projectId = "…";
const environmentId = "…";
const serviceId = "…";

await api.setVariable(projectId, environmentId, serviceId, "API_KEY", {
  value: "…", // a secret: never read back
});
await api.setVariable(projectId, environmentId, serviceId, "LOG_LEVEL", {
  value: "info",
  secret: false,
});
const { variables } = await api.listVariables(projectId, environmentId);
console.log(variables.map((variable) => `${variable.key} ${variable.secret ? "(secret)" : variable.value}`));
await api.deleteVariable(projectId, environmentId, serviceId, "LOG_LEVEL");
```

### Build-time variables

A visible value with `buildTime: true` is also handed to the service's builds as a Docker build argument, for a value the framework bakes into the bundle (`NEXT_PUBLIC_*`, `VITE_*`); a change to it rebuilds the service. **A build-time variable is public:** its value lands in the image's layer history and provenance, where anyone who can pull the image reads it. That is why only a visible value carries the mark: a new variable needs `secret: false` with it, and a secret is refused with `cloud.errors.settings.entry.build_time_secret`.

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const projectId = "…";
const environmentId = "…";
const serviceId = "…";

await api.setVariable(projectId, environmentId, serviceId, "NEXT_PUBLIC_SITE_URL", {
  value: "https://shop.example",
  secret: false,
  buildTime: true,
});
await api.setVariable(projectId, environmentId, serviceId, "NEXT_PUBLIC_SITE_URL", {
  value: "https://shop.example",
  buildTime: false, // back to a runtime-only variable
});
```

A write without `buildTime` keeps the mark a held variable has. Every listed variable carries `buildTime` (false for secrets and wired variables); an API older than the field leaves it out. The name is upper case (`^[A-Z_][A-Z0-9_]*$`) and not one the build reserves (`BUILD_COMMAND`, `NODE_ENV`, `ANTELOPEJS_LAUNCH_ENV`, `BUILD_DATE`, `VCS_REF`, `VERSION`, `BUILDKIT_*` and the proxy names `HTTP_PROXY`, `HTTPS_PROXY`, `FTP_PROXY`, `NO_PROXY`, `ALL_PROXY`), else `cloud.errors.settings.entry.build_time_name`; the value is one line of at most 1024 characters without control characters, else `cloud.errors.settings.entry.build_time_value`. A service marks at most 32 variables, 64 KiB encoded in all: `cloud.errors.settings.build_time_limit` beyond.

## Maintenance window of a database

The platform holds back the updates of a managed database (engine and operator releases, security fixes) and restarts it to apply them inside its maintenance window only: one weekly slot, a day, a start hour and a duration of 1 to 4 hours, read on the wall clock of an IANA time zone, so it stays at the same hour through summer time. A database whose owner chose none runs the platform's default, Sunday 02:00 to 05:00 in `Europe/Brussels`. An update that waited 14 days is applied at the next opening even if the database does not read healthy. `api.maintenanceWindows` reads, chooses and resets the window of a database, by its service id:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const serviceId = "…"; // a managed database

const { window, isDefault, nextStart, nextEnd, canEdit } = await api.maintenanceWindows.read(serviceId);
console.log(window, isDefault, `next: ${nextStart} to ${nextEnd}`, canEdit);

await api.maintenanceWindows.set(serviceId, {
  day: "tuesday", // MAINTENANCE_WINDOW_DAYS lists them, Monday first
  startHour: 1, // 0 to 23
  durationHours: 2, // 1 to 4
  timeZone: "Europe/Paris",
});
await api.maintenanceWindows.reset(serviceId); // back to the platform's default
```

`nextStart` and `nextEnd` are the opening in progress, or the next one, as ISO 8601 instants. Only the workspace's owner chooses, on a paid plan: `canEdit` says whether the caller may, a member is refused with `cloud.errors.settings.maintenance_window_owner_only` (403) and a workspace on Free with `cloud.errors.settings.maintenance_window_plan_locked` (409). A window outside the bounds is refused with `cloud.errors.settings.invalid_maintenance_window`, a zone the API does not know with `cloud.errors.settings.unknown_time_zone` (400), and a service that is not a managed database with `cloud.errors.settings.unknown_service` (404). Choosing a window redeploys nothing. `serviceSettings` reads the window in force too, as `database.maintenanceWindow` with its `isDefault`; an API older than the field leaves it out.

## List a project's deployments

`api.projectDeployments.list` returns one page of deployments across all environments, newest first. Follow `nextCursor` while it is not `null`, with the same filters:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const projectId = "…";

let cursor: string | undefined;
do {
  const page = await api.projectDeployments.list(projectId, {
    status: ["failed"],
    limit: 50,
    cursor,
  });
  for (const deployment of page.deployments) {
    console.log(deployment.number, deployment.status, deployment.commit);
  }
  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

`environmentId` restricts the list to one environment, and `limit` is 1 to 100.

## Read a build's logs

`api.buildLogs` streams the output of one build as `log` events, then `end`. Without `follow` it is the newest `limit` lines (500 at most), oldest first; with `follow` it tails the build:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const buildId = "…";

for await (const event of api.buildLogs(buildId, { follow: false, limit: 200 })) {
  if (event.event === "log") console.log(event.data);
}
```

A build that is unknown, of another workspace, or whose service was removed is refused with 404 `cloud.errors.builds.not_found`. The `buildId` is the one `deploy` returns in its receipt.

## Types

`paths`, `components` and `operations` are the types generated from
`openapi/cloud.openapi.yaml`, which the package also ships with the other
files of `openapi/` that it references.
