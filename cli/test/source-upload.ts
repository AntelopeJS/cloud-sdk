import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";

const MAX_SOURCE_BYTES = 95 * 1024 * 1024;

/** Parses the API's single-file upload contract over the actual HTTP transport. */
export async function receiveTestSource(
  request: IncomingMessage,
  maxBytes = MAX_SOURCE_BYTES,
): Promise<Buffer> {
  const parser = Busboy({
    headers: request.headers,
    limits: { files: 1, fields: 0, fileSize: maxBytes },
  });
  const chunks: Buffer[] = [];
  let files = 0;
  let invalid = false;
  parser.on("file", (field, stream, info) => {
    files += 1;
    invalid ||= field !== "source" || !info.filename?.endsWith(".tar");
    invalid ||= info.mimeType !== "application/x-tar";
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("limit", () => {
      invalid = true;
    });
  });
  parser.on("filesLimit", () => {
    invalid = true;
  });
  parser.on("fieldsLimit", () => {
    invalid = true;
  });
  await pipeline(request, parser);
  const archive = Buffer.concat(chunks);
  assert.equal(invalid, false, "invalid source multipart upload");
  assert.equal(files, 1);
  assert.ok(archive.length > 0);
  return archive;
}
