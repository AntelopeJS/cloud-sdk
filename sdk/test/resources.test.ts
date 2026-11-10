import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CloudApi,
  CloudApiError,
  type AppliedResources,
  type EnvironmentResources,
  type ResourcePlan,
} from "../src/index.js";

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: string;
}

function recorder(answer: () => Response) {
  const sent: Sent[] = [];
  const send: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    sent.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    });
    return answer();
  };
  return { sent, send };
}

type Answer = AppliedResources | EnvironmentResources | ResourcePlan | string;

function json(status: number, body: Answer): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ENVIRONMENT_URL =
  "https://api.antelopejs.cloud/api/cloud/projects/p-1/environments/e-1";

const REDIS = {
  label: "Redis",
  version: "8.10",
  volumeGb: 5,
  instances: 1,
  backups: true,
  connectionVariable: "REDIS_URL",
  monthlyCost: {
    included: false,
    currency: "EUR",
    floor: 4.15,
    ceiling: 11.45,
  },
} as const;

const PLAN: ResourcePlan = {
  create: [
    {
      ...REDIS,
      module: "@antelopejs/redis",
      engine: "redis",
      mode: "single",
      name: "redis-2",
    },
  ],
  existing: [
    {
      module: "@antelopejs/mongodb",
      serviceId: "svc-1",
      name: "mongodb",
      engine: "mongodb",
    },
  ],
  unprovided: [
    {
      module: "@antelopejs/rethinkdb",
      resource: "RethinkDB",
      reason: "not_offered",
    },
    {
      module: "@antelopejs/postgres",
      resource: "PostgreSQL",
      reason: "not_on_plan",
      requiredTier: "hobby",
    },
  ],
  cost: { included: false, currency: "EUR", floor: 4.15, ceiling: 11.45 },
  limits: {
    tier: "free",
    planName: "Free",
    servicesPerEnvironment: { used: 3, ceiling: 20, afterApply: 4 },
    databasesPerEnvironment: null,
  },
  refusals: [],
  canApply: true,
};

const FREE_TWO_DATABASES: ResourcePlan = {
  ...PLAN,
  limits: {
    tier: "free",
    planName: "Free",
    servicesPerEnvironment: { used: 0, ceiling: 20, afterApply: 2 },
    databasesPerEnvironment: { used: 0, ceiling: 1, afterApply: 2 },
  },
  refusals: ["databases_per_environment"],
  canApply: false,
};

function api(send: typeof fetch): CloudApi {
  return new CloudApi({ token: "t-1", fetch: send });
}

describe("environment resources", () => {
  test("reads the databases an environment runs with a GET and no body", async () => {
    const answer: EnvironmentResources = {
      environmentId: "e-1",
      resources: [
        {
          ...REDIS,
          serviceId: "svc-2",
          name: "redis",
          appName: "shop-redis",
          engine: "redis",
          mode: "single",
          module: "@antelopejs/redis",
        },
      ],
    };
    const { sent, send } = recorder(() => json(200, answer));

    const resources = await api(send).environmentResources("p-1", "e-1");

    assert.deepEqual(sent, [
      {
        url: `${ENVIRONMENT_URL}/resources`,
        method: "GET",
        authorization: "Bearer t-1",
        body: "",
      },
    ]);
    assert.deepEqual(resources, answer);
  });

  test("encodes the project and environment ids into the path", async () => {
    const { sent, send } = recorder(() =>
      json(200, { environmentId: "e/1", resources: [] }),
    );

    await api(send).environmentResources("p/1", "e/1");

    assert.equal(
      sent[0]?.url,
      "https://api.antelopejs.cloud/api/cloud/projects/p%2F1/environments/e%2F1/resources",
    );
  });
});

describe("resource plan", () => {
  test("posts the modules to the plan and returns the plan as the server computed it", async () => {
    const { sent, send } = recorder(() => json(200, PLAN));

    const plan = await api(send).planResources("p-1", "e-1", [
      "@antelopejs/redis",
      "@antelopejs/rethinkdb",
    ]);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, "POST");
    assert.equal(sent[0]?.url, `${ENVIRONMENT_URL}/resource-plan`);
    assert.equal(sent[0]?.authorization, "Bearer t-1");
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      modules: ["@antelopejs/redis", "@antelopejs/rethinkdb"],
    });
    assert.deepEqual(plan, PLAN);
  });

  test("tells an unprovided need that needs a tier from one that cannot be offered", async () => {
    const { send } = recorder(() => json(200, PLAN));

    const plan = await api(send).planResources("p-1", "e-1", []);

    const tiers = plan.unprovided.map((entry) =>
      entry.reason === "not_on_plan" ? entry.requiredTier : null,
    );
    assert.deepEqual(tiers, [null, "hobby"]);
  });

  test("returns the refusals and the database ceiling of a plan the apply would refuse", async () => {
    const { send } = recorder(() => json(200, FREE_TWO_DATABASES));

    const plan = await api(send).planResources("p-1", "e-1", [
      "@antelopejs/redis",
      "@antelopejs/mongodb",
    ]);

    assert.equal(plan.canApply, false);
    assert.deepEqual(plan.refusals, ["databases_per_environment"]);
    assert.deepEqual(plan.limits.databasesPerEnvironment, {
      used: 0,
      ceiling: 1,
      afterApply: 2,
    });
  });

  test("names each database the plan creates by the service name the apply will use", async () => {
    const { send } = recorder(() => json(200, PLAN));

    const plan = await api(send).planResources("p-1", "e-1", [
      "@antelopejs/redis",
    ]);

    assert.deepEqual(
      plan.create.map(({ name }) => name),
      ["redis-2"],
    );
  });

  test("a refusal is a CloudApiError carrying the status and the stable key", async () => {
    const { send } = recorder(() =>
      json(400, "cloud.errors.resources.invalid_modules"),
    );

    await assert.rejects(api(send).planResources("p-1", "e-1", []), (error) => {
      assert.ok(error instanceof CloudApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "cloud.errors.resources.invalid_modules");
      return true;
    });
  });
});

describe("resource plan apply", () => {
  test("posts the modules, never a plan, and returns what was created and the plan that remains", async () => {
    const answer: AppliedResources = {
      created: [
        {
          ...REDIS,
          serviceId: "svc-2",
          name: "redis",
          appName: "shop-redis",
          engine: "redis",
          mode: "single",
          module: "@antelopejs/redis",
        },
      ],
      plan: { ...PLAN, create: [] },
    };
    const { sent, send } = recorder(() => json(200, answer));

    const applied = await api(send).applyResources("p-1", "e-1", [
      "@antelopejs/redis",
    ]);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, "POST");
    assert.equal(sent[0]?.url, `${ENVIRONMENT_URL}/resource-plan/apply`);
    assert.deepEqual(JSON.parse(sent[0]?.body ?? ""), {
      modules: ["@antelopejs/redis"],
    });
    assert.deepEqual(applied, answer);
  });

  for (const code of [
    "cloud.errors.resources.over_service_limit",
    "cloud.errors.resources.over_database_limit",
    "cloud.errors.resources.preview_environment",
  ]) {
    test(`an apply the plan refuses is a 409 CloudApiError carrying ${code}`, async () => {
      const { send } = recorder(() => json(409, code));

      await assert.rejects(
        api(send).applyResources("p-1", "e-1", ["@antelopejs/redis"]),
        (error) => {
          assert.ok(error instanceof CloudApiError);
          assert.equal(error.status, 409);
          assert.equal(error.code, code);
          return true;
        },
      );
    });
  }
});
