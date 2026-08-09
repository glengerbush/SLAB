import { expect, test } from "./fixtures";

const welcomeRoute = "/cms/?view=posts&post=26-07-26--welcome";

test("supports CMS deep links and Back/Forward navigation", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await expect(page).toHaveURL(welcomeRoute);
  await expect(page).toHaveTitle(
    "Welcome to the example blog — Example Blog Editor",
  );

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(page).toHaveURL("/cms/?view=media");
  await expect(page).toHaveTitle("Media — Example Blog Editor");
  await expect(
    page.getByRole("heading", { name: "Media", exact: true }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(welcomeRoute);
  await expect(
    page.getByRole("heading", { name: "Welcome to the example blog" }),
  ).toBeVisible();
  await expect(page.locator("#cms-content")).toBeFocused();

  await page.goBack();
  await expect(page).toHaveURL("/cms/");
  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(welcomeRoute);
  await expect(
    page.getByRole("heading", { name: "Welcome to the example blog" }),
  ).toBeVisible();
});

test("opens section and Post URLs directly", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  await expect(page).toHaveTitle("Settings — Example Blog Editor");
  await expect(
    page.getByRole("heading", { name: "Site settings" }),
  ).toBeVisible();

  await page.goto(welcomeRoute);
  await expect(
    page.getByRole("heading", { name: "Welcome to the example blog" }),
  ).toBeVisible();

  await page.goto("/cms/?view=posts&post=missing");
  await expect(page).toHaveURL("/cms/?view=posts");
  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();
});

test("keeps unsaved changes when Back navigation is cancelled", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Keep this unsaved title");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();

  await expect(page).toHaveURL(welcomeRoute);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Keep this unsaved title",
  );
});
