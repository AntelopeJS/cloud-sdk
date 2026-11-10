import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { isString } from "../src/guards.js";
import { receiveTestSource } from "./source-upload.js";

const TEST_FILE_LIMIT = 16;
const ACCEPTED = 202;
const INVALID_UPLOAD = 400;
let origin = "";
const server = createServer(async (request, response) => {
  try {
    await receiveTestSource(request, TEST_FILE_LIMIT);
    response.writeHead(ACCEPTED);
  } catch {
    response.writeHead(INVALID_UPLOAD);
  }
  response.end();
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && !isString(address));
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function sourceForm(size = 1, field = "source"): FormData {
  const form = new FormData();
  form.append(
    field,
    new Blob([new Uint8Array(size)], {
      type: "application/x-tar",
    }),
    "source.tar",
  );
  return form;
}

async function statusOf(
  body: BodyInit,
  headers?: HeadersInit,
): Promise<number> {
  const response = await fetch(origin, { method: "POST", body, headers });
  await response.arrayBuffer();
  return response.status;
}

test("rejects the original raw tar transport", async () => {
  assert.equal(
    await statusOf(new Uint8Array([1]), {
      "Content-Type": "application/x-tar",
    }),
    INVALID_UPLOAD,
  );
});

test("rejects multipart without a boundary", async () => {
  assert.equal(
    await statusOf(sourceForm(), {
      "Content-Type": "multipart/form-data",
    }),
    INVALID_UPLOAD,
  );
});

test("requires a non-empty file named source", async () => {
  assert.equal(await statusOf(new FormData()), INVALID_UPLOAD);
  assert.equal(await statusOf(sourceForm(0)), INVALID_UPLOAD);
  assert.equal(await statusOf(sourceForm(1, "archive")), INVALID_UPLOAD);
});

test("rejects additional files and text fields", async () => {
  const files = sourceForm();
  files.append("source", new Blob(["extra"]), "extra.tar");
  assert.equal(await statusOf(files), INVALID_UPLOAD);
  const fields = sourceForm();
  fields.append("extra", "value");
  assert.equal(await statusOf(fields), INVALID_UPLOAD);
});

test("enforces the parser file limit independently of multipart overhead", async () => {
  assert.equal(await statusOf(sourceForm(TEST_FILE_LIMIT - 1)), ACCEPTED);
  assert.equal(await statusOf(sourceForm(TEST_FILE_LIMIT)), INVALID_UPLOAD);
  assert.equal(await statusOf(sourceForm(TEST_FILE_LIMIT + 1)), INVALID_UPLOAD);
});
