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

## Port and exposure

A service built from a repository has no port, and is refused its deployments until it has one. Both setters take effect at the next deployment:

```ts
import { CloudApi } from "@antelopejs/cloud-sdk";

const api = new CloudApi({ token: process.env.ANTELOPE_CLOUD_TOKEN! });
const serviceId = "…";

await api.setServicePort(serviceId, 8080); // 1024 to 65535, or null to clear
await api.setServiceExposure(serviceId, true); // false closes it again
```

`setServiceExposure` refuses a service without a port with `cloud.errors.settings.public_needs_port`.

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
