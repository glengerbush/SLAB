import { expect, test } from "./fixtures";

test("does not recover changes discarded through the browser leave prompt", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Discard this change");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    await dialog.accept();
  });
  await page.goto("/");
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();

  await expect(page.getByTestId("recovery-panel")).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Welcome to the example blog",
  );
});

test("does not recover changes discarded when choosing another Post", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Discard this change");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });
  await page.getByRole("button", { name: /A private sample draft/ }).click();
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();

  await expect(page.getByTestId("recovery-panel")).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Welcome to the example blog",
  );
});

test("keeps divergent crash recovery beside the disk version until discarded", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(value: string) {
          (
            window as typeof window & { copiedRecovery?: string }
          ).copiedRecovery = value;
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto("/cms/");
  const response = await page.request.get(
    "/api/local-cms/posts/26-07-26--welcome",
  );
  const disk = (await response.json()) as Record<string, unknown>;
  const recoveredBody =
    "Recovered opening paragraph.\n\n## Recovered section\n\nThese changes exist only in browser recovery.";
  const recovery = {
    ...disk,
    revision: `${String(disk.revision)}-older`,
    title: "Recovered welcome title",
    description: "Description recovered from the interrupted session.",
    body: recoveredBody,
  };
  await page.evaluate(
    ({ value }) =>
      localStorage.setItem(
        "local-cms:26-07-26--welcome",
        JSON.stringify(value),
      ),
    { value: recovery },
  );

  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  const panel = page.getByTestId("recovery-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".recovery-version")).toHaveCount(2);
  await expect(panel).toContainText("Nothing has been replaced");
  await expect(panel.getByRole("button", { name: "Copy details" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /Save/ })).toBeDisabled();

  const recovered = panel
    .locator(".recovery-version")
    .filter({ hasText: "Recovered browser copy" });
  const bodyHeading = recovered.locator(".recovery-body-head strong");
  const copyBody = recovered.getByRole("button", { name: "Copy body" });
  const [headingBox, buttonBox] = await Promise.all([
    bodyHeading.boundingBox(),
    copyBody.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(
    Math.abs(
      headingBox!.y +
        headingBox!.height / 2 -
        (buttonBox!.y + buttonBox!.height / 2),
    ),
  ).toBeLessThan(2);

  await copyBody.click();
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { copiedRecovery?: string }).copiedRecovery,
    ),
  ).toBe(recoveredBody);
  const copiedNotice = page.getByText("Recovered body copied.");
  await expect(copiedNotice).toBeVisible();
  await expect(copiedNotice).not.toBeVisible({ timeout: 6_000 });

  await panel.getByRole("button", { name: "Discard recovery" }).click();
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("local-cms:26-07-26--welcome"),
    ),
  ).toBeNull();
});
