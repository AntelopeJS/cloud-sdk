import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";
import { defineConfig } from "oxlint";

const GENERATED_PATTERNS = ["src/generated/**"];

/**
 * node:test runs every `describe` and `test` it registers and reports their
 * failures itself, so the promises they return are not left floating.
 */
const NODE_TEST_CALLS = {
  from: "package",
  package: "node:test",
  name: ["describe", "test"],
} as const;

/** A `describe` block is not a function anyone splits. */
const TEST_RULES = {
  "eslint/max-lines-per-function": "off",
} as const;

/**
 * Rules Biome's recommended set enforced as errors that the preset leaves off.
 * The `no-use-before-define` options limit it to reads in the temporal dead
 * zone, as Biome's rule did.
 */
const BIOME_ERRORS = {
  "eslint/array-callback-return": "error",
  "eslint/no-case-declarations": "error",
  "eslint/no-constructor-return": "error",
  "eslint/no-fallthrough": "error",
  "eslint/no-inner-declarations": "error",
  "eslint/no-label-var": "error",
  "eslint/no-redeclare": "error",
  "eslint/no-self-compare": "error",
  "eslint/no-use-before-define": [
    "error",
    {
      functions: false,
      classes: false,
      variables: false,
      typedefs: false,
      ignoreTypeReferences: true,
    },
  ],
  "typescript/no-empty-interface": "error",
  "unicorn/new-for-builtins": "error",
  "oxc/misrefactored-assign-op": "error",
} as const;

export default defineConfig({
  extends: [antelopePreset()],
  ignorePatterns: [...ANTELOPE_IGNORE_PATTERNS, ...GENERATED_PATTERNS],
  options: { typeAware: true, maxWarnings: 0 },
  rules: {
    ...BIOME_ERRORS,
    "eslint/no-console": "error",
    "typescript/no-floating-promises": [
      "error",
      { allowForKnownSafeCalls: [NODE_TEST_CALLS] },
    ],
  },
  overrides: [{ files: ["test/**"], rules: TEST_RULES }],
});
