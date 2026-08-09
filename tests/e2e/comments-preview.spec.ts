import { expect, test } from "./fixtures";

test("offers the published Comments experience in local development", async ({
  page,
}) => {
  await page.goto("/cms/");
  const token = await page
    .locator('meta[name="local-cms-token"]')
    .getAttribute("content");
  expect(token).toBeTruthy();

  const headers = { "X-Local-CMS-Token": token! };
  const currentResponse = await page.request.get("/api/local-cms/settings", {
    headers,
  });
  const current = await currentResponse.json();
  const saveResponse = await page.request.put("/api/local-cms/settings", {
    headers,
    data: {
      settings: {
        ...current.settings,
        comments: {
          provider: "giscus",
          enabled: true,
          repository: "author/conversations",
          repositoryId: "R_kgDOExample",
          category: "Announcements",
          categoryId: "DIC_kwDOExample",
          requireConsent: true,
          lazy: true,
          reactions: true,
          inputPosition: "bottom",
        },
      },
      expectedRevision: current.settingsRevision,
    },
  });
  expect(saveResponse.ok()).toBe(true);

  await page.route("https://giscus.app/client.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        const frame = document.createElement("iframe");
        frame.className = "giscus-frame";
        frame.title = "Comments";
        document.currentScript.parentElement.append(frame);
      `,
    }),
  );
  await page.goto("/posts/welcome/");

  const comments = page.getByRole("region", { name: "Comments" });
  await expect(comments).toBeVisible();
  await expect(
    comments.getByRole("button", { name: "Show comments" }),
  ).toBeVisible();
  await expect(comments.getByText(/Comments are unavailable/)).toBeHidden();

  await comments.getByRole("button", { name: "Show comments" }).click();
  await expect(comments.locator("iframe.giscus-frame")).toBeVisible();
  await expect(comments.locator("script[data-term]")).toHaveAttribute(
    "data-term",
    /^Welcome to the example blog \[[a-f0-9]{12}\]$/,
  );
  await expect(comments.locator("script[data-theme]")).toHaveAttribute(
    "data-theme",
    /^data:text\/css;charset=utf-8,.*%23fffcf0/i,
  );
});
