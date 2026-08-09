import { expect, test } from "./fixtures";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test("ignores a polling response for a Post that is no longer selected", async ({
  page,
}) => {
  const requested = deferred();
  const release = deferred();
  await page.route(
    "**/api/local-cms/sync?folder=26-07-26--welcome",
    async (route) => {
      const response = await route.fetch();
      const sync = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...sync, revision: `${String(sync.revision)}-changed` },
      });
    },
  );
  await page.route(
    "**/api/local-cms/posts/26-07-26--welcome",
    async (route) => {
      const response = await route.fetch();
      const post = (await response.json()) as Record<string, unknown>;
      requested.resolve();
      await release.promise;
      await route.fulfill({
        response,
        json: {
          ...post,
          title: "Stale remote response",
          revision: `${String(post.revision)}-stale`,
        },
      });
    },
  );

  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await requested.promise;
  await page.getByRole("button", { name: /A private sample draft/ }).click();
  release.resolve();

  await expect(page.locator(".editor-head h1")).toHaveText(
    "A private sample draft",
  );
  await expect(page.getByText("Stale remote response")).toHaveCount(0);
});

test("checks the selected Post when the window regains focus", async ({
  page,
}) => {
  await page.route(
    "**/api/local-cms/sync?folder=26-07-26--welcome",
    async (route) => {
      const response = await route.fetch();
      const sync = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...sync, revision: `${String(sync.revision)}-changed` },
      });
    },
  );

  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Unsaved local title");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect(
    page.getByText("This file changed outside the CMS."),
  ).toBeVisible();
});

test("locks Post and section navigation while a save is active", async ({
  page,
}) => {
  const requested = deferred();
  const release = deferred();
  await page.route(
    "**/api/local-cms/posts/26-07-26--welcome",
    async (route) => {
      if (route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      requested.resolve();
      await release.promise;
      await route.continue();
    },
  );

  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.locator(".post-title input").fill("Saved without a race");
  await page.getByRole("button", { name: /Save/ }).click();
  await requested.promise;

  await expect(
    page.getByRole("button", { name: /A private sample draft/ }),
  ).toBeDisabled();
  for (const name of ["Posts", "Media", "Settings"]) {
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }

  release.resolve();
  await expect(page.getByText("Saved.")).toBeVisible();
});
