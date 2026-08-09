import { expect, test } from "./fixtures";

test("explains the limits of AI training controls", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  await page
    .getByRole("button", {
      name: "Why is AI training blocking best effort?",
    })
    .hover();

  await expect(
    page.getByRole("tooltip").filter({ hasText: "No universal" }),
  ).toContainText(
    "AI search and user-requested fetchers available for discovery",
  );
});

test("shows actionable inline errors for an incomplete social link", async ({
  page,
}) => {
  let saveRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().includes("/api/local-cms/settings")
    )
      saveRequests += 1;
  });

  await page.goto("/cms/?view=settings");
  await page.getByRole("button", { name: "Add social link" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();

  const label = page.getByLabel("Social 1 link name");
  const url = page.getByLabel("Social 1 URL");
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a link name.")).toBeVisible();
  await expect(
    page.getByText("Enter a complete URL, including https://."),
  ).toBeVisible();
  await expect(page.locator(".toast-error")).toHaveCount(0);
  expect(saveRequests).toBe(0);
});

test("explains the social link name and keeps icon choices readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/cms/?view=settings");
  await page.getByRole("button", { name: "Add social link" }).click();

  const linkName = page.getByLabel("Social 1 link name");
  const linkUrl = page.getByLabel("Social 1 URL");
  await expect(linkName).toHaveAttribute("placeholder", "Link name");
  await expect(
    page.getByText(
      "Link name is the icon’s accessible name and hover text; it also helps Auto-detect choose an icon.",
    ),
  ).toBeVisible();
  const iconWidth = await page
    .getByLabel("Social 1 icon")
    .evaluate((select) => Math.round(select.getBoundingClientRect().width));
  const fieldWidths = await Promise.all(
    [linkName, linkUrl].map((field) =>
      field.evaluate((input) =>
        Math.round(input.getBoundingClientRect().width),
      ),
    ),
  );
  expect(fieldWidths.every((width) => width >= 380)).toBe(true);
  expect(iconWidth).toBeGreaterThanOrEqual(136);
});

test("distinguishes remove controls from add actions", async ({ page }) => {
  await page.goto("/cms/?view=settings");
  await page.getByRole("button", { name: "Add social link" }).click();

  const navigationRemove = page.getByRole("button", {
    name: "Remove navigation link 1: Posts",
  });
  const socialRemove = page.getByRole("button", {
    name: "Remove social link 1",
  });
  for (const remove of [navigationRemove, socialRemove]) {
    await expect(remove.locator("svg")).toHaveCount(1);
    await expect(remove).toHaveClass(/remove-row-button/);
  }
  const [removeColor, addColor] = await Promise.all([
    socialRemove.evaluate((button) => getComputedStyle(button).color),
    page
      .getByRole("button", { name: "Add social link" })
      .evaluate((button) => getComputedStyle(button).color),
  ]);
  expect(removeColor).not.toBe(addColor);
});

test("validates every free-text Settings group beside its controls", async ({
  page,
}) => {
  await page.goto("/cms/?view=settings");
  await page.getByLabel("Blog title").fill("");
  const siteDescription = page.getByRole("textbox", {
    name: "Site description",
    exact: true,
  });
  await siteDescription.fill("");
  await page.getByLabel("Author").fill("");
  await page.getByLabel("Canonical domain").fill("http://example.com");
  await page.getByLabel("Locale").fill("not a locale!");
  await page.getByLabel("Navigation 1 label").fill("");
  await page.getByLabel("Navigation 1 URL").fill("javascript:alert(1)");
  await page.getByLabel("Allowed iframe origins").fill("http://example.com");
  await page.getByLabel("Advanced rules").fill("x".repeat(5001));
  await page.getByRole("button", { name: "Save settings" }).click();

  const invalidFields = [
    page.getByLabel("Blog title"),
    siteDescription,
    page.getByLabel("Author"),
    page.getByLabel("Canonical domain"),
    page.getByLabel("Locale"),
    page.getByLabel("Navigation 1 label"),
    page.getByLabel("Navigation 1 URL"),
    page.getByLabel("Allowed iframe origins"),
    page.getByLabel("Advanced rules"),
  ];
  for (const field of invalidFields)
    await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText("Review the highlighted fields, then save again."),
  ).toBeVisible();
});

test("never exposes raw schema errors from the Settings API", async ({
  page,
}) => {
  await page.goto("/cms/?view=settings");
  const result = await page.evaluate(async () => {
    const current = await fetch("/api/local-cms/settings").then((response) =>
      response.json(),
    );
    const token = document.querySelector<HTMLMetaElement>(
      'meta[name="local-cms-token"]',
    )?.content;
    const response = await fetch("/api/local-cms/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Local-CMS-Token": token ?? "",
      },
      body: JSON.stringify({
        settings: { ...current.settings, title: "" },
        expectedRevision: current.settingsRevision,
      }),
    });
    return { status: response.status, body: await response.json() };
  });

  expect(result).toEqual({
    status: 400,
    body: {
      error: "Some values are invalid. Review the form and try again.",
    },
  });
});
