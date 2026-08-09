import { expect, test } from "./fixtures";

test("shows success-toast time remaining before dismissal", async ({
  page,
}) => {
  await page.goto("/cms/?view=settings");
  await page.getByLabel("Blog title").fill("Toast progress test");
  await page.getByRole("button", { name: "Save settings" }).click();

  const toast = page.locator(".toast-success");
  await expect(toast).toBeVisible();
  const progress = await toast.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      animationName: style.animationName,
      animationDuration: style.animationDuration,
      animationTimingFunction: style.animationTimingFunction,
      transformOrigin: style.transformOrigin,
    };
  });
  expect(progress.animationName).toContain("toast-expiry");
  expect(progress.animationDuration).toBe("5s");
  expect(progress.animationTimingFunction).toBe("linear");
  expect(progress.transformOrigin.split(" ")[0]).toBe("0px");
  await expect(toast).not.toBeVisible({ timeout: 6_000 });
});

test("gives each success toast an independent timer", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  const title = page.getByLabel("Blog title");

  await title.fill("Discard this title");
  await page.getByRole("button", { name: "Discard changes" }).click();
  await page
    .getByRole("dialog", { name: "Discard settings changes?" })
    .getByRole("button", { name: "Discard changes" })
    .click();
  const first = page.locator(".toast-success", {
    hasText: "Settings changes discarded.",
  });
  await expect(first).toBeVisible();

  await page.waitForTimeout(2_500);
  await title.fill("Save this title");
  await page
    .getByRole("button", { name: "Save settings" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  const second = page.locator(".toast-success", {
    hasText: "Settings saved.",
  });
  await expect(second).toBeVisible();
  await expect(first).toBeVisible();

  await expect(first).not.toBeVisible({ timeout: 3_500 });
  await expect(second).toBeVisible();
  await expect(second).not.toBeVisible({ timeout: 3_500 });
});

test("prevents clicks from passing through a toast", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  await page.getByLabel("Blog title").fill("Toast pointer safety test");
  await page.getByRole("button", { name: "Save settings" }).click();

  const toast = page.locator(".toast-success");
  await expect(toast).toBeVisible();
  const box = await toast.boundingBox();
  expect(box).not.toBeNull();

  await page.evaluate((toastBox) => {
    const coveredButton = document.createElement("button");
    coveredButton.id = "toast-covered-test-button";
    coveredButton.dataset.clicks = "0";
    coveredButton.style.cssText = `position:fixed;z-index:29;left:${toastBox.x}px;top:${toastBox.y}px;width:${toastBox.width}px;height:${toastBox.height}px;opacity:0`;
    coveredButton.addEventListener("click", () => {
      coveredButton.dataset.clicks = String(
        Number(coveredButton.dataset.clicks) + 1,
      );
    });
    document.body.append(coveredButton);
  }, box!);

  await page.mouse.click(box!.x + 20, box!.y + box!.height / 2);
  await expect(page.locator("#toast-covered-test-button")).toHaveAttribute(
    "data-clicks",
    "0",
  );
});
