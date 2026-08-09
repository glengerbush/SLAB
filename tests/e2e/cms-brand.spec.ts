import { expect, test } from "./fixtures";

test("brands the CMS with the last-saved site title", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  const brand = page.locator(".cms-brand");
  const title = page.getByLabel("Blog title");

  await expect(brand).toContainText("Example Blog");
  await expect(brand).toContainText("Editor");
  await title.fill("Renamed Blog");
  await expect(brand).toContainText("Example Blog");

  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(brand).toContainText("Renamed Blog");
  await expect(page).toHaveTitle("Settings — Renamed Blog Editor");

  await page.setViewportSize({ width: 375, height: 667 });
  const headerBox = await page.locator(".topbar").boundingBox();
  const toastBox = await page.locator(".toast-success").boundingBox();
  expect(headerBox).not.toBeNull();
  expect(toastBox).not.toBeNull();
  expect(toastBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
});

test("updates the CMS header accent after saving settings", async ({
  page,
}) => {
  await page.goto("/cms/?view=settings");
  await page.getByLabel("Light").check();

  await page.getByLabel("Accent color").fill("#24837b");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  const accents = await page.locator(".app").evaluate((app) => {
    const styles = getComputedStyle(app);
    return {
      active: styles.getPropertyValue("--accent").trim().toLowerCase(),
      light: styles.getPropertyValue("--accent-light").trim().toLowerCase(),
    };
  });
  expect(accents.active).toBe(accents.light);

  await page.getByLabel("Dark").check();
  const darkAccents = await page.locator(".app").evaluate((app) => {
    const styles = getComputedStyle(app);
    return {
      active: styles.getPropertyValue("--accent").trim().toLowerCase(),
      dark: styles.getPropertyValue("--accent-dark").trim().toLowerCase(),
    };
  });
  expect(darkAccents.active).toBe(darkAccents.dark);
});
