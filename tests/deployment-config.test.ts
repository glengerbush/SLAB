import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import YAML from "yaml";

test("deploys only audited dist from main with least privilege", async () => {
  const source = await readFile(".github/workflows/deploy.yml", "utf8");
  const workflow = YAML.parse(source) as Record<string, any>;
  const trigger = workflow.on ?? workflow.true;

  expect(trigger.push.branches).toEqual(["main"]);
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.jobs.deploy.permissions).toEqual({
    contents: "read",
    deployments: "write",
  });
  const steps = workflow.jobs.deploy.steps as Array<Record<string, any>>;
  const build = steps.findIndex((step) => step.run === "npm run build");
  const deploy = steps.findIndex((step) =>
    String(step.with?.command).startsWith("pages deploy dist "),
  );
  expect(build).toBeGreaterThan(-1);
  expect(deploy).toBeGreaterThan(build);
  expect(source).toContain("CLOUDFLARE_API_TOKEN");
  expect(source).toContain("CLOUDFLARE_ACCOUNT_ID");
  expect(source).not.toMatch(/pages deploy (?!dist\b)/);
  for (const step of steps.filter((value) => value.uses)) {
    expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  }
});
