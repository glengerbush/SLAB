import { expect, test } from "./fixtures";

test("discards Settings changes back to the last saved values", async ({
  page,
}) => {
  await page.goto("/cms/?view=settings");
  const title = page.getByLabel("Blog title");
  const discard = page.getByRole("button", {
    name: "Discard changes",
  });
  await expect(discard).toBeDisabled();

  await title.fill("Changed Blog title");
  await expect(discard).toBeEnabled();
  await discard.click();

  const dialog = page.getByRole("dialog", {
    name: "Discard settings changes?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(title).toHaveValue("Changed Blog title");

  await discard.click();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(title).toHaveValue("Example Blog");
  await expect(discard).toBeDisabled();
});

test("discards changes to an existing Post", async ({ page }) => {
  await page.goto("/cms/?view=posts&post=26-07-26--welcome");
  const title = page.getByLabel("Title");
  const discard = page.getByRole("button", { name: "Discard changes" });
  await expect(discard).toBeDisabled();

  const savedTitle = await title.inputValue();
  await title.fill("Changed Post title");
  await expect(discard).toBeEnabled();
  await discard.click();

  const dialog = page.getByRole("dialog", {
    name: "Discard unsaved Post changes?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await expect(title).toHaveValue(savedTitle);
  await expect(discard).toBeDisabled();
});

test("discards an unsaved new Post and closes its editor", async ({ page }) => {
  await page.goto("/cms/?view=posts");
  await page.getByRole("button", { name: "New post" }).click();
  const discard = page.getByRole("button", { name: "Discard new Post" });
  await expect(discard).toBeDisabled();

  await page.getByLabel("Title").fill("Never saved");
  await expect(discard).toBeEnabled();
  await discard.click();

  const dialog = page.getByRole("dialog", {
    name: "Discard this new Post?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Discard new Post" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();
});
