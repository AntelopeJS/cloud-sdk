import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { describeApiError } from "../src/error-messages.js";

describe("first deploy error messages", () => {
  test("tells refusals of a first deploy apart, in both languages", () => {
    const cases: [number, string, RegExp, RegExp][] = [
      [409, "cloud.errors.projects.slug_taken", /--project/, /--project/],
      [409, "cloud.errors.limits.hostnames_per_tenant", /hostname/, /hôte/],
      [
        422,
        "cloud.errors.builds.unsupported_source_archive",
        /could not read/,
        /pas pu lire/,
      ],
      [503, "cloud.errors.infra.unavailable", /again later/, /plus tard/],
      [
        422,
        "cloud.errors.builds.no_build_recipe",
        /package\.json with a start script/,
        /package\.json avec un script start/,
      ],
      [
        422,
        "cloud.errors.builds.missing_start_script",
        /npx serve dist.*Dockerfile/,
        /npx serve dist.*Dockerfile/,
      ],
      [
        422,
        "cloud.errors.builds.monorepo_unsupported",
        /monorepo.*Dockerfile/,
        /monorepo.*Dockerfile/,
      ],
      [
        413,
        "cloud.errors.builds.source_too_large",
        /\.cloudignore/,
        /\.cloudignore/,
      ],
      [
        422,
        "cloud.errors.builds.submodules_unsupported",
        /submodules/,
        /sous-modules/,
      ],
      [
        422,
        "cloud.errors.builds.lfs_unsupported",
        /Git LFS.*Dockerfile/,
        /Git LFS.*Dockerfile/,
      ],
    ];
    for (const [status, code, english, french] of cases) {
      const error = new CloudApiError(status, code);
      assert.match(JSON.stringify(describeApiError(error, "en")), english);
      assert.match(JSON.stringify(describeApiError(error, "fr")), french);
      assert.deepEqual(describeApiError(error, "en").details, [
        `${code} (HTTP ${status})`,
      ]);
    }
  });
});

describe("first deploy build refusals with values", () => {
  test("fills the Node.js versions the API names", () => {
    const error = new CloudApiError(
      422,
      "cloud.errors.builds.node_version_unsupported",
      undefined,
      { requested: ">=26", supported: "20, 22, 24" },
    );
    assert.equal(
      describeApiError(error, "en").title,
      "No supported Node.js version matches >=26",
    );
    assert.equal(
      describeApiError(error, "fr").reason,
      "Versions prises en charge : 20, 22, 24.",
    );
  });
});
