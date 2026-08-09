import { expect, test } from "./fixtures";

test("keeps Custom Content locked and exact in the visual editor", async ({
  page,
}) => {
  const custom = [
    '<iframe src="/effect.html" title="Effect"></iframe>',
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>',
    '<section data-effect="sparkle"><p>Fallback text.</p></section>',
  ];

  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  await page
    .getByLabel("Markdown and HTML source")
    .fill(`Before\n\n${custom.join("\n\n")}\n\nAfter`);
  await page.getByRole("tab", { name: "Visual" }).click();

  const placeholders = page.locator(".custom-content-placeholder");
  await expect(placeholders).toHaveCount(3);
  await expect(placeholders.nth(0)).toContainText("IFRAME Custom Content");
  await expect(placeholders.nth(1)).toContainText("SVG Custom Content");
  await expect(placeholders.nth(2)).toContainText("SECTION Custom Content");
  for (const placeholder of await placeholders.all()) {
    await expect(placeholder).toHaveAttribute("contenteditable", "false");
  }

  const body = page.getByRole("textbox", { name: "Post body" });
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" edited");
  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  const source = await page.getByLabel("Markdown and HTML source").inputValue();
  for (const markup of custom) expect(source).toContain(markup);
  expect(source).toContain(" edited");
});
