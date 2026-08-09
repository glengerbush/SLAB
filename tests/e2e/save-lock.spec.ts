import { expect, test } from "./fixtures";

function gate() {
  let reached!: () => void;
  let release!: () => void;
  return {
    reached: new Promise<void>((resolve) => (reached = resolve)),
    release: new Promise<void>((resolve) => (release = resolve)),
    markReached: reached,
    open: release,
  };
}

test("locks the active Post form during Save", async ({ page }) => {
  const save = gate();
  await page.route("**/api/local-cms/posts/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    save.markReached();
    await save.release;
    await route.continue();
  });
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Saved title");

  await page.getByRole("button", { name: /Save/ }).click();
  await save.reached;

  await expect(page.locator("main.editor-pane")).toHaveAttribute("inert", "");
  await expect(
    page.locator("main.editor-pane button.primary", { hasText: "Saving…" }),
  ).toBeVisible();
  save.open();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.locator("main.editor-pane")).not.toHaveAttribute(
    "inert",
    "",
  );
});

test("locks the Settings form during Save", async ({ page }) => {
  const save = gate();
  await page.route("**/api/local-cms/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    save.markReached();
    await save.release;
    await route.continue();
  });
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Blog title").fill("Saved title");

  await page.getByRole("button", { name: "Save settings" }).click();
  await save.reached;

  await expect(page.locator("main.settings")).toHaveAttribute("inert", "");
  await expect(
    page.locator("main.settings button.primary", { hasText: "Saving…" }),
  ).toBeVisible();
  save.open();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.locator("main.settings")).not.toHaveAttribute("inert", "");
});
