import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { readCredentials, writeCredentials } from "../src/config.js";
import { CliError } from "../src/errors.js";

const SAVED = {
  apiUrl: "https://api.example.test",
  consoleUrl: "https://console.example.test",
  token: "secret-token",
  workspace: "workspace-1",
};

async function configHomeHolding(text: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "cloud-credentials-"));
  const path = join(home, "antelopejs", "cloud.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return home;
}

describe("saved credentials", () => {
  test("reads back what login saved", async () => {
    const home = await mkdtemp(join(tmpdir(), "cloud-credentials-"));
    await writeCredentials(home, SAVED);
    assert.deepEqual(await readCredentials(home), SAVED);
  });

  test("reads anything that is not a complete session as signed out", async () => {
    const texts = [
      "null",
      "[]",
      "7",
      JSON.stringify({ ...SAVED, token: 5 }),
      JSON.stringify({ ...SAVED, token: "" }),
      JSON.stringify({ ...SAVED, workspace: undefined }),
      JSON.stringify({ ...SAVED, apiUrl: ["https://api.example.test"] }),
      JSON.stringify({ ...SAVED, consoleUrl: undefined }),
    ];
    for (const text of texts) {
      const home = await configHomeHolding(text);
      await assert.rejects(
        readCredentials(home),
        (error) =>
          error instanceof CliError && error.code === "not_authenticated",
        text,
      );
    }
  });
});
