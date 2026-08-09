import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "./fixtures";

test("retains a stale Settings form until reloaded from file", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Settings" }).click();
  const title = page.getByLabel("Blog title");
  await title.fill("Browser title");

  const testRoot = (
    await readFile(resolve(".astro", "acceptance-root.txt"), "utf8")
  ).trim();
  const path = resolve(testRoot, "site.config.yaml");
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace("title: Example Blog", "title: File title"),
  );

  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings changed in the file.")).toBeVisible();
  await expect(title).toHaveValue("Browser title");
  await expect(
    page.getByRole("button", { name: "Save settings" }),
  ).toBeDisabled();
  expect(await readFile(path, "utf8")).toContain("title: File title");

  await page.getByRole("button", { name: "Reload settings from file" }).click();
  await expect(title).toHaveValue("File title");
  await expect(page.getByText("Settings changed in the file.")).toHaveCount(0);
});
