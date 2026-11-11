# `@antelopejs/cloud-sdk`

A typed client for the AntelopeJS Cloud API: the client the `ajs-cloud` CLI
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

## Types

`paths`, `components` and `operations` are the types generated from
`openapi/cloud.openapi.yaml`, which the package also ships with the other
files of `openapi/` that it references.
