import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { detectApp, detectBuildKind, detectPort } from "../src/detect.js";
import {
  alternativeAppName,
  defaultAppName,
  isValidProjectSlug,
  slugify,
  suggestProjectSlug,
} from "../src/naming.js";

describe("first deploy naming and detection", () => {
  test("slugifies folder names with the API's rules", () => {
    assert.equal(slugify("Café Shop!"), "cafe-shop");
    assert.equal(isValidProjectSlug("a"), false);
    assert.equal(isValidProjectSlug("ab"), true);
    assert.equal(suggestProjectSlug("demo", new Set(["demo-2"])), "demo-3");
  });

  test("keeps application names within 40 characters", () => {
    const long = defaultAppName("a".repeat(40), "api");
    assert.equal(long.length, 40);
    assert.equal(defaultAppName("a".repeat(40), "api"), long);
    assert.ok(alternativeAppName(long).length <= 40);
  });

  test("leaves out a generic service name and the words the project already has", () => {
    assert.equal(defaultAppName("shop", "web"), "shop");
    assert.equal(defaultAppName("shop", "app"), "shop");
    assert.equal(defaultAppName("shop", "api"), "shop-api");
    assert.equal(defaultAppName("shop", "shop-admin"), "shop-admin");
    assert.equal(defaultAppName("shop", "shop"), "shop");
    assert.equal(
      defaultAppName("e2e-msp-mushinkarate", "e2e-msp-dash-upload"),
      "e2e-msp-mushinkarate-dash-upload",
    );
    assert.equal(defaultAppName("shop", "webshop"), "shop-webshop");
  });

  test("lets through what the API may build, and only that", () => {
    assert.equal(detectBuildKind(["server.js", "README.md"]), null);
    assert.equal(detectBuildKind(["package.json"]), "node");
    assert.equal(
      detectBuildKind(["package.json", "antelope.config.mjs"]),
      "antelope",
    );
    assert.equal(
      detectBuildKind(["package.json", "antelope.config.ts", "Dockerfile"]),
      "dockerfile",
    );
    assert.equal(detectBuildKind(["dockerfile", "package.jsonc"]), null);
  });

  test("detects the port from a Dockerfile, the scripts or the framework", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloud-detect-"));
    assert.equal(await detectPort(root), null);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { astro: "5" } }),
    );
    assert.equal(await detectPort(root), 4321);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { start: "node server.js --port 5000" } }),
    );
    assert.equal(await detectPort(root), 5000);
    await writeFile(join(root, "Dockerfile"), "FROM node\nexpose 7000\n");
    assert.equal(await detectPort(root), 7000);
    assert.equal((await detectApp(root)).port, 7000);
  });

  test("reads a package.json of any shape without failing", async () => {
    const root = await mkdtemp(join(tmpdir(), "cloud-detect-"));
    const manifests: [string, number | null][] = [
      ["not json", null],
      ["null", null],
      ["[]", null],
      ['"text"', null],
      ['{"scripts":"node --port 5000"}', null],
      ['{"scripts":["node --port 5000"]}', null],
      ['{"scripts":{"start":5}}', null],
      ['{"scripts":{"start":5,"serve":"node . --port 3001"}}', 3001],
    ];
    for (const [text, port] of manifests) {
      await writeFile(join(root, "package.json"), text);
      assert.equal(await detectPort(root), port, text);
    }
  });
});
