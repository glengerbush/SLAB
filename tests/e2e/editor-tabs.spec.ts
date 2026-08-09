import { expect, test } from "./fixtures";

test("Post editor tabs expose complete relationships and keyboard navigation", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page.getByRole("button", { name: /A private sample draft/ }).click();

  const visual = page.getByRole("tab", { name: "Visual" });
  const source = page.getByRole("tab", { name: "Markdown / HTML" });
  await expect(visual).toHaveAttribute("aria-controls", "editor-panel-visual");
  await expect(source).toHaveAttribute("aria-controls", "editor-panel-source");
  await expect(visual).toHaveAttribute("tabindex", "0");
  await expect(source).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel", { name: "Visual" })).toBeVisible();

  await visual.focus();
  await page.keyboard.press("ArrowRight");
  await expect(source).toBeFocused();
  await expect(source).toHaveAttribute("aria-selected", "true");
  await expect(source).toHaveAttribute("tabindex", "0");
  await expect(visual).toHaveAttribute("tabindex", "-1");
  await expect(
    page.getByRole("tabpanel", { name: "Markdown / HTML" }),
  ).toBeVisible();

  await page.keyboard.press("Home");
  await expect(visual).toBeFocused();
  await expect(visual).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(source).toBeFocused();
  await page.keyboard.press("End");
  await expect(source).toBeFocused();
});
