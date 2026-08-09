import { expect, test } from "./fixtures";

test("boots from test-owned CMS data", async ({ page }) => {
  await page.goto("/cms/");
  const response = await page.request.get("/api/local-cms/bootstrap");
  const bootstrap = await response.json();
  const posts = bootstrap.posts as Array<{ title: string; updated: string }>;

  expect(posts.map((post) => post.title).sort()).toEqual([
    "A private sample draft",
    "Add responsive images and captions",
    "Go beyond the visual editor",
    "Welcome to the example blog",
  ]);
  expect(
    posts.find((post) => post.title === "Go beyond the visual editor")?.updated,
  ).toBe("2026-08-08");
  expect(bootstrap.settings.title).toBe("Example Blog");
  expect(bootstrap.settings.accentColor).toBe("#BC5215");
});
