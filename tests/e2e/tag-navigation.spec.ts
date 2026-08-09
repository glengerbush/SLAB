import { expect, test } from "./fixtures";

test("lists every tag and keeps Tags navigation active", async ({ page }) => {
  await page.goto("/tags/");

  const tagsNavigation = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Tags", exact: true });
  await expect(tagsNavigation).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();

  await page.getByRole("link", { name: "Notes", exact: true }).click();

  await expect(page).toHaveURL(/\/tags\/notes\/$/);
  await expect(tagsNavigation).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "Posts tagged “Notes”" }),
  ).toBeVisible();
});
