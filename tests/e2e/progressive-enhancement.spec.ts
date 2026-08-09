import { expect, test } from "./fixtures";

test("shows the theme selector only when JavaScript is available", async ({
  browser,
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".theme-selector")).toBeVisible();

  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
  });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto("/");
  await expect(noScriptPage.locator(".theme-selector")).toBeHidden();
  await expect(noScriptPage.locator("html")).toHaveCSS(
    "background-color",
    "rgb(16, 15, 15)",
  );
  await noScriptContext.close();
});
