import { expect, test } from "./fixtures";

test("updates the date on Save without requiring a Git commit", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  const source = page.getByLabel("Markdown and HTML source");
  await source.fill(
    `${await source.inputValue()}\n\nSaved without a Git commit.`,
  );

  await page.getByRole("button", { name: /Save/ }).click();

  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Updated")).toHaveValue(
    new Date().toISOString().slice(0, 10),
  );
});

test("allows the Author to clear an Updated date", async ({ page }) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Go beyond the visual editor/ })
    .click();

  const updated = page.getByLabel("Updated");
  await expect(updated).toHaveValue("2026-08-08");
  await updated.fill("");
  await page.getByRole("button", { name: /Save/ }).click();

  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(updated).toHaveValue("");
});
