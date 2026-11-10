import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  sortImports: { newlinesBetween: false },
  ignorePatterns: ["**/*.md", "openapi/**", "src/generated/**"],
});
