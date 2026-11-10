import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/**
 * `check:generated` diffs `src/generated` against a fresh openapi-typescript
 * run, so formatting it would fail that check. The spec and Markdown are left
 * as written.
 *
 * Imports are sorted without a blank line between groups, as the sources are
 * written.
 */
export default antelopeFmtPreset({
  sortImports: { newlinesBetween: false },
  ignorePatterns: ["**/*.md", "openapi/**", "src/generated/**"],
});
