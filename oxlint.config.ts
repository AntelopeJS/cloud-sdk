import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/**
 * node:test runs every `describe` and `it` it registers and reports their
 * failures itself, so the promises they return are not left floating.
 */
const NODE_TEST_CALLS = {
  from: "package",
  package: "node:test",
  name: ["describe", "it"],
} as const;

export default defineConfig({
  extends: [antelopePreset()],
  ignorePatterns: ANTELOPE_IGNORE_PATTERNS,
  options: { typeAware: true },
  rules: {
    "typescript/no-floating-promises": [
      "error",
      { allowForKnownSafeCalls: [NODE_TEST_CALLS] },
    ],
  },
});
