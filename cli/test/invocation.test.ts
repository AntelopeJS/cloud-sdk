import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { asInvoked, commandName } from "../src/invocation.js";

describe("how a hint names the command", () => {
  test("names the ajs plugin command by default", () => {
    assert.equal(commandName({}), "ajs cloud");
    assert.equal(commandName({ npm_command: "run-script" }), "ajs cloud");
    assert.equal(
      asInvoked("Run ajs-cloud login, then ajs-cloud deploy", {}),
      "Run ajs cloud login, then ajs cloud deploy",
    );
  });

  test("names the scoped package when npx runs the command", () => {
    const env = { npm_command: "exec" };
    assert.equal(commandName(env), "npx @antelopejs/cloud");
    assert.equal(
      asInvoked("Run ajs-cloud login", env),
      "Run npx @antelopejs/cloud login",
    );
  });

  test("never names a bare command to a person who came through npx", () => {
    const hint = asInvoked("ajs-cloud status", { npm_command: "exec" });
    assert.doesNotMatch(hint, /(^|\s)ajs(-cloud)?(\s|$)/);
  });
});
