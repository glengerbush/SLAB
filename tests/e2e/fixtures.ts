import { cp, copyFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { expect, test as base } from "@playwright/test";

async function resetAcceptanceBlog() {
  const target = await readFile(
    resolve(".astro", "acceptance-root.txt"),
    "utf8",
  )
    .then((value) => value.trim())
    .catch(() => "");
  if (
    !target ||
    dirname(target) !== tmpdir() ||
    !basename(target).startsWith("blog-acceptance-")
  )
    throw new Error("Invalid acceptance Blog root");

  const fixtureRoot = resolve("tests", "e2e", "site-fixture");
  await rm(resolve(target, "content"), { recursive: true, force: true });
  await cp(resolve(fixtureRoot, "content"), resolve(target, "content"), {
    recursive: true,
  });
  await copyFile(
    resolve(fixtureRoot, "site.config.yaml"),
    resolve(target, "site.config.yaml"),
  );
  await rm(resolve(target, ".git"), { recursive: true, force: true });
}

const test = base.extend({
  page: async ({ page }, use) => {
    await resetAcceptanceBlog();
    await use(page);
  },
});

export { expect, test };
