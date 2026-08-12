import { expect, test } from "./fixtures";

test("adds and round-trips a footnote from the visual editor", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page.getByRole("button", { name: /A private sample draft/ }).click();

  const body = page.getByRole("textbox", { name: "Post body" });
  await body.focus();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Footnote", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Add footnote" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Footnote text" })
    .fill("A useful supporting detail.");
  await dialog.getByRole("button", { name: "Add footnote" }).click();

  await expect(body.locator('sup[data-footnote-reference="1"]')).toHaveText(
    "1",
  );
  await expect(body.locator('div[data-footnote-definition="1"]')).toContainText(
    "A useful supporting detail.",
  );

  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  const source = page.getByRole("textbox", {
    name: "Markdown and HTML source",
  });
  await expect(source).toHaveValue(
    /never enter the published artifact\.\[\^1\]/,
  );
  await expect(source).toHaveValue(/\[\^1\]: A useful supporting detail\./);

  await page.getByRole("tab", { name: "Visual" }).click();
  await expect(
    page
      .getByRole("textbox", { name: "Post body" })
      .locator('div[data-footnote-definition="1"]'),
  ).toContainText("A useful supporting detail.");
});
