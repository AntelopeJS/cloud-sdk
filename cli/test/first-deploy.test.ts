import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { CloudApiError } from "@antelopejs/cloud-sdk";
import { readProjectConfig, writeProjectConfig } from "../src/config.js";
import { describeApiError } from "../src/error-messages.js";
import { CliError } from "../src/errors.js";
import {
  EXISTING_SERVICES_PATH,
  PROJECTS_PATH,
  SERVICES_PATH,
  api,
  posted,
  run,
  scripted,
  serveMockApi,
  told,
  types,
} from "./first-deploy-fixture.js";
import { jsonAt, parseJson, textAt } from "./json.js";

serveMockApi();

describe("first deploy from an unlinked folder", () => {
  test("creates the project and service, links the folder and deploys in CI mode", async () => {
    const current = await scripted("Fresh App");
    await run(current.runtime, ["--json", "--yes", "deploy"]);
    assert.deepEqual(posted(PROJECTS_PATH), [
      { slug: "fresh-app", region: "eu-central" },
    ]);
    assert.deepEqual(posted(SERVICES_PATH), [
      {
        name: "web",
        appName: "fresh-app",
        source: { type: "upload" },
        port: 8080,
        isPublic: true,
      },
    ]);
    assert.deepEqual(await readProjectConfig(current.root), {
      workspace: "workspace-1",
      project: "project-new",
      services: { web: { path: "." } },
    });
    assert.ok(api.archive && api.archive.length > 0);
    assert.deepEqual(types(current.output), [
      "project_not_linked",
      "deploy_plan",
      "project_created",
      "service_created",
      "service_ceiling",
      "project_linked",
      "deploy_started",
      "deploy_event",
      "deploy_event",
      "deploy_succeeded",
    ]);
    assert.deepEqual(current.prompts, []);
    assert.deepEqual(current.confirms, []);
  });

  test("shows the plan with the ceiling once the service exists", async () => {
    const current = await scripted("fresh");
    await run(current.runtime, ["--yes", "deploy"]);
    assert.ok(current.output.includes("ℹ Deployment plan"));
    const plan = current.output.join("\n");
    assert.match(plan, /Project\s+fresh \(new\)/);
    assert.match(plan, /Environment\s+production/);
    assert.match(plan, /Service\s+web \(new\) :8080/);
    assert.match(plan, /Source\s+upload of this folder/);
    assert.ok(current.output.includes("ℹ Max cost: €21.90/month"));
  });

  test("asks for every value, keeping the defaults on empty answers", async () => {
    const current = await scripted("fresh", { prompts: ["", "api", "9000"] });
    await run(current.runtime, ["deploy"]);
    assert.deepEqual(current.prompts, [
      "Project name (fresh)",
      "Service name (web)",
      "Port the app listens on (8080)",
    ]);
    assert.deepEqual(current.confirms, ["Create and deploy?"]);
    assert.deepEqual(posted(SERVICES_PATH), [
      {
        name: "api",
        appName: "fresh-api",
        source: { type: "upload" },
        port: 9000,
        isPublic: true,
      },
    ]);
  });

  test("re-asks an invalid project name instead of sending it", async () => {
    const current = await scripted("fresh", {
      prompts: ["Not Valid", "ok-name"],
    });
    await run(current.runtime, ["deploy"]);
    assert.equal(
      current.prompts.filter((line) => line.startsWith("Project name")).length,
      2,
    );
    assert.deepEqual(posted(PROJECTS_PATH), [
      { slug: "ok-name", region: "eu-central" },
    ]);
  });

  test("creates nothing when the plan is declined", async () => {
    const current = await scripted("fresh", { confirms: [false] });
    await run(current.runtime, ["deploy"]);
    assert.ok(current.output.includes("– Nothing was changed"));
    assert.ok(api.requests.every((request) => request.startsWith("GET ")));
    await assert.rejects(readProjectConfig(current.root));
  });

  test("refuses a taken slug in CI mode without creating anything", async () => {
    const current = await scripted("demo");
    await assert.rejects(run(current.runtime, ["--yes", "deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "project_slug_taken");
      assert.match(told(error), /demo already exists.*--project demo/);
      return true;
    });
    assert.deepEqual(posted(PROJECTS_PATH), []);
  });

  test("refuses a folder name that is not a valid slug in CI mode", async () => {
    const current = await scripted("x");
    await assert.rejects(run(current.runtime, ["--yes", "deploy"]), {
      code: "invalid_project_slug",
    });
    assert.deepEqual(api.requests, [
      "GET /api/cloud/workspace-provisioning",
      "GET /api/cloud/projects/",
    ]);
  });

  test("deploys to the user's existing project when confirmed", async () => {
    const current = await scripted("demo", { confirms: [true, true] });
    await run(current.runtime, ["deploy"]);
    assert.deepEqual(current.confirms, [
      "demo already exists. Deploy to it?",
      "Create and deploy?",
    ]);
    assert.deepEqual(posted(PROJECTS_PATH), []);
    assert.equal(posted(EXISTING_SERVICES_PATH).length, 1);
    assert.equal(
      (await readProjectConfig(current.root)).project,
      "project-demo",
    );
  });

  test("only asks to deploy when everything already exists", async () => {
    api.services.push({
      id: "service-web",
      name: "web",
      status: "online",
      primaryHost: null,
    });
    const current = await scripted("anything");
    await run(current.runtime, ["deploy", "--project", "demo"]);
    assert.deepEqual(current.confirms, ["Deploy?"]);
    assert.deepEqual(current.prompts, ["Service name (web)"]);
  });

  test("reuses an existing service named with --project in CI mode", async () => {
    api.services.push({
      id: "service-web",
      name: "web",
      status: "online",
      primaryHost: null,
    });
    const current = await scripted("anything");
    await run(current.runtime, [
      "--json",
      "--yes",
      "deploy",
      "--project",
      "demo",
    ]);
    assert.deepEqual(posted(PROJECTS_PATH), []);
    assert.deepEqual(posted(EXISTING_SERVICES_PATH), []);
    assert.ok(
      api.requests.includes(
        "POST /api/cloud/services/service-web/source-deployments",
      ),
    );
    const plan = parseJson(current.output[1]);
    assert.equal(jsonAt(plan, "type"), "deploy_plan");
    assert.equal(jsonAt(plan, "data", "isNewProject"), false);
    assert.equal(jsonAt(plan, "data", "isNewService"), false);
    assert.equal(jsonAt(plan, "data", "port"), null);
    assert.match(textAt(plan, "data", "ceiling"), /month/);
  });

  test("deploys a folder inside a linked one on its own when named with --project", async () => {
    const current = await scripted("repo/frontend");
    const parent = dirname(current.root);
    const parentLink = {
      workspace: "workspace-1",
      project: "project-demo",
      services: { web: { path: "." } },
    };
    await writeProjectConfig(parent, parentLink);
    await run(current.runtime, [
      "--json",
      "--yes",
      "deploy",
      "frontend",
      "--project",
      "demo",
      "--port",
      "3000",
    ]);
    assert.deepEqual(posted(PROJECTS_PATH), []);
    assert.deepEqual(posted(EXISTING_SERVICES_PATH), [
      {
        name: "frontend",
        appName: "demo-frontend",
        source: { type: "upload" },
        port: 3000,
        isPublic: true,
      },
    ]);
    assert.deepEqual(await readProjectConfig(current.root), {
      workspace: "workspace-1",
      project: "project-demo",
      services: { frontend: { path: "." } },
    });
    assert.deepEqual(await readProjectConfig(parent), parentLink);
    assert.ok(
      api.requests.includes(
        "POST /api/cloud/services/service-new/source-deployments",
      ),
    );
  });

  test("proposes the next free slug when the user declines the existing project", async () => {
    const current = await scripted("demo", {
      prompts: ["", "", ""],
      confirms: [false, true],
    });
    await run(current.runtime, ["deploy"]);
    assert.ok(current.prompts.includes("Project name (demo-2)"));
    assert.deepEqual(posted(PROJECTS_PATH), [
      { slug: "demo-2", region: "eu-central" },
    ]);
  });

  test("asks for another slug when a project outside the user's scope holds it", async () => {
    api.projectReplies.push({
      status: 409,
      body: "cloud.errors.projects.slug_taken",
    });
    const current = await scripted("hidden", { prompts: ["", "", "", ""] });
    await run(current.runtime, ["deploy"]);
    assert.ok(
      current.output.includes("▲ hidden is already taken in this workspace"),
    );
    assert.deepEqual(posted(PROJECTS_PATH), [
      { slug: "hidden", region: "eu-central" },
      { slug: "hidden-2", region: "eu-central" },
    ]);
  });

  test("stops before creating anything when the role cannot create projects", async () => {
    api.canCreateProjects = false;
    const current = await scripted("fresh");
    await assert.rejects(run(current.runtime, ["deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "project_creation_forbidden");
      assert.match(told(error), /ajs cloud link/);
      return true;
    });
    assert.deepEqual(posted(PROJECTS_PATH), []);
    assert.deepEqual(current.prompts, ["Project name (fresh)"]);
  });

  test("surfaces the service ceiling refusal with the API code", async () => {
    api.serviceReplies.push({
      status: 409,
      body: "cloud.errors.limits.services_per_environment",
    });
    const current = await scripted("fresh");
    await assert.rejects(run(current.runtime, ["--yes", "deploy"]), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.code, "cloud.errors.limits.services_per_environment");
      assert.match(describeApiError(error, "en").title, /service limit/);
      return true;
    });
    await assert.rejects(readProjectConfig(current.root));
  });

  test("retries a public name another application holds", async () => {
    api.serviceReplies.push({
      status: 409,
      body: "cloud.errors.services.app_name_taken",
    });
    const current = await scripted("fresh");
    await run(current.runtime, ["--yes", "deploy"]);
    const names = posted(SERVICES_PATH).map((body) => textAt(body, "appName"));
    assert.equal(names[0], "fresh");
    assert.match(names[1] ?? "", /^fresh-[0-9a-f]{4}$/);
  });

  test("refuses a folder the API cannot build before any request", async () => {
    const current = await scripted("fresh");
    await rm(join(current.root, "Dockerfile"));
    await assert.rejects(run(current.runtime, ["--yes", "deploy"]), (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.code, "unsupported_source");
      assert.match(told(error), /Dockerfile/);
      assert.match(told(error), /package\.json/);
      return true;
    });
    assert.deepEqual(api.requests, []);
  });

  test("accepts an AntelopeJS project without a Dockerfile", async () => {
    const current = await scripted("fresh");
    await rm(join(current.root, "Dockerfile"));
    await writeFile(
      join(current.root, "antelope.config.ts"),
      "export default {};\n",
    );
    await run(current.runtime, ["--yes", "deploy"]);
    assert.equal(posted(PROJECTS_PATH).length, 1);
  });

  test("leaves a Node app to the API, on port 3000 when none is named", async () => {
    const current = await scripted("fresh");
    await rm(join(current.root, "Dockerfile"));
    await writeFile(
      join(current.root, "package.json"),
      JSON.stringify({ scripts: { start: "node server.js" } }),
    );
    await run(current.runtime, ["--yes", "deploy"]);
    assert.equal(jsonAt(posted(SERVICES_PATH)[0], "port"), 3000);
  });

  test("validates explicit options before any write", async () => {
    const current = await scripted("fresh");
    await assert.rejects(
      run(current.runtime, ["--yes", "deploy", "--port", "99999"]),
      { code: "invalid_port" },
    );
    await assert.rejects(
      run(current.runtime, ["--yes", "deploy", "--region", "mars"]),
      (error) => {
        assert.ok(error instanceof CliError);
        assert.equal(error.code, "unknown_region");
        assert.match(told(error), /eu-central/);
        return true;
      },
    );
    assert.deepEqual(posted(PROJECTS_PATH), []);
  });
});
