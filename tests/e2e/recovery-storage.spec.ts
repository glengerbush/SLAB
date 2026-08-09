import { expect, test } from "./fixtures";

test("keeps editing available when browser recovery storage rejects a Post", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("local-cms:"))
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/cms/");
  await page.getByRole("button", { name: /A private sample draft/ }).click();
  const title = page.getByLabel("Title", { exact: true });
  await title.fill("Draft still editable");

  await expect(title).toHaveValue("Draft still editable");
  await expect(page.getByRole("alert")).toContainText(
    "Browser recovery could not be saved",
  );
  expect(pageErrors).toEqual([]);
});
