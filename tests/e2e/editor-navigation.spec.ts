import { expect, test } from "./fixtures";

test("skips the Post list and identifies every required Post field", async ({
  page,
}) => {
  await page.goto("/cms/");
  const skip = page.getByRole("link", { name: "Skip to CMS content" });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#cms-content")).toBeFocused();

  await page.getByRole("button", { name: "New post" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Accessible draft");
  await page.getByLabel("Slug", { exact: true }).fill("accessible-draft");
  await page.getByRole("button", { name: /Save/ }).click();

  const description = page.getByLabel("Post description", { exact: true });
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a short Post description.")).toBeVisible();
});

test("opens Settings without selecting a post", async ({ page }) => {
  await page.route("**/api/local-cms/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    delete bootstrap.settings.accentColor;
    await route.fulfill({ response, json: bootstrap });
  });
  await page.goto("/cms/");
  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();

  await expect(
    page.getByRole("heading", { name: "Site settings" }),
  ).toBeVisible();
});

test("keeps the Media import card within a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Media", exact: true }).click();

  const overflow = await page.locator(".library-import").evaluate((card) => ({
    card: card.scrollWidth - card.clientWidth,
    page: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(overflow).toEqual({ card: 0, page: 0 });
});

test("collapses the Post chooser after selecting a Post on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/cms/");

  const chooser = page.locator(".post-browser");
  const summary = chooser.locator(":scope > summary");
  await expect(chooser).toHaveAttribute("open", "");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();

  await expect(chooser).not.toHaveAttribute("open", "");
  await expect(summary).toContainText("Change post");
  await expect(summary).toContainText("Welcome to the example blog");
  expect((await summary.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator(".post-menu")).not.toBeVisible();
  expect(
    (await page.locator(".editor-head h1").boundingBox())!.width,
  ).toBeGreaterThan(280);

  await summary.click();
  await expect(page.locator(".post-menu")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    pixels: document.documentElement.scrollWidth - window.innerWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > innerWidth)
      .map((element) => `${element.tagName}.${element.className}`)
      .slice(0, 8),
  }));
  expect(overflow).toEqual({ pixels: 0, offenders: [] });
});

test("scrolls the desktop Post sidebar independently", async ({ page }) => {
  await page.route("**/api/local-cms/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    const seed = bootstrap.posts.find(
      (post: { folder: string }) => post.folder === "26-07-31--custom-content",
    );
    const overflowPosts = Array.from({ length: 12 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, "0");
      return {
        ...seed,
        folder: `26-06-${suffix}--overflow-${suffix}`,
        title: `Overflow Post ${suffix}`,
        slug: `overflow-${suffix}`,
      };
    });
    bootstrap.posts.push(...overflowPosts);
    await route.fulfill({ response, json: bootstrap });
  });
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/cms/?view=posts&post=26-07-31--custom-content");

  const sidebar = page.locator(".sidebar");
  const initialTop = (await sidebar.boundingBox())!.y;
  const dimensions = await sidebar.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await sidebar.evaluate((element) => element.scrollTo(0, 160));
  expect(
    await sidebar.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 300));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect((await sidebar.boundingBox())!.y).toBeCloseTo(initialTop, 0);
  expect(
    await sidebar.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});

test("stages global media selection before offering Import", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Media", exact: true }).click();

  await expect(page.getByRole("button", { name: "Import" })).toHaveCount(0);
  const dropzone = page.locator(".library-dropzone");
  await expect(dropzone).toContainText("Drop an image here or browse");
  await dropzone.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(
        [
          '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>',
        ],
        "dropped-global.svg",
        { type: "image/svg+xml" },
      ),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
    );
  });

  await expect(page.locator(".library-selected-file")).toContainText(
    "dropped-global.svg",
  );
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toBeEnabled();
});

test("drops files into each Post image slot", async ({ page }) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("Pair", { exact: true }).check();

  const dropzones = page.locator(".post-image-dropzone");
  await expect(dropzones).toHaveCount(2);
  for (const [index, filename] of [
    "first-drop.svg",
    "second-drop.svg",
  ].entries()) {
    const dropzone = dropzones.nth(index);
    await dropzone.evaluate((element) => {
      element.dispatchEvent(
        new DragEvent("dragenter", {
          bubbles: true,
          dataTransfer: new DataTransfer(),
        }),
      );
    });
    await expect(dropzone).toHaveClass(/drag-active/);
    await dropzone.evaluate((element, name) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"></svg>',
          ],
          name,
          { type: "image/svg+xml" },
        ),
      );
      element.dispatchEvent(
        new DragEvent("drop", { bubbles: true, dataTransfer: transfer }),
      );
    }, filename);
    await expect(dropzone).toContainText(filename);
    await expect(dropzone).not.toHaveClass(/drag-active/);
  }
});

test("distinguishes every Post status with labeled badges", async ({
  page,
}) => {
  const statuses = [
    { internal: "Draft", label: "Draft" },
    { internal: "Ready", label: "Publish ready" },
    { internal: "Unreleased", label: "Update ready" },
    { internal: "Published", label: "Published" },
  ];
  await page.route("**/api/local-cms/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    statuses.forEach((status, index) => {
      bootstrap.posts[index].status = status.internal;
    });
    await route.fulfill({ response, json: bootstrap });
  });
  await page.goto("/cms/");

  const badges = statuses.map((status) =>
    page.locator(`.post-status[data-status="${status.internal}"]`).first(),
  );
  for (const [index, badge] of badges.entries()) {
    await expect(badge).toHaveText(statuses[index].label);
    await expect(badge).toHaveAttribute("title", /.+/);
  }
  const colors = await Promise.all(
    badges.map((badge) =>
      badge.evaluate((element) => getComputedStyle(element).color),
    ),
  );
  expect(new Set(colors).size).toBe(statuses.length);
});

test("clearly confirms discarding an unsaved new Post", async ({ page }) => {
  let createRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/local-cms/posts")
    )
      createRequests += 1;
  });
  await page.goto("/cms/");
  await page.getByRole("button", { name: "New post" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Throw this away");

  await page.getByRole("button", { name: "Discard new Post" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Discard this new Post?",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("permanently lost");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "Discard new Post" }),
  ).toHaveClass(/destructive/);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Throw this away",
  );
  await page.getByRole("button", { name: "Discard new Post" }).click();
  await dialog.getByRole("button", { name: "Discard new Post" }).click();

  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();
  expect(createRequests).toBe(0);
});

test("deletes saved drafts and warns before deleting published Posts", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByRole("button", { name: "Delete Post", exact: true }).click();
  const publishedDialog = page.getByRole("dialog", {
    name: "Delete this published Post?",
  });
  await expect(publishedDialog).toContainText(
    "/posts/welcome/ will return a 404 page",
  );
  await publishedDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: /A private sample draft/ }).click();
  await page.getByRole("button", { name: "Delete Post", exact: true }).click();
  const draftDialog = page.getByRole("dialog", {
    name: "Delete this draft?",
  });
  const deleteDraft = draftDialog.getByRole("button", {
    name: "Delete draft",
  });
  await expect(draftDialog).toContainText("entire folder");
  await expect(deleteDraft).toHaveClass(/destructive/);
  await deleteDraft.click();

  await expect(
    page.getByText("Deleted “A private sample draft”."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /A private sample draft/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Choose a post" }),
  ).toBeVisible();
  const deleted = await page.request.get(
    "/api/local-cms/posts/26-08-06--sample-draft",
  );
  expect(deleted.ok()).toBe(false);
});

test("excludes Draft-owned media from the default Social Image gallery", async ({
  page,
}) => {
  await page.route("**/api/local-cms/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    const media = (name: string, folder: string) => ({
      scope: "post",
      id: `${name}.svg`,
      name,
      importedAt: "2026-08-07T12:00:00.000Z",
      kind: "svg",
      files: [`${name}.svg`],
      src: `/media/${folder}/${name}.svg`,
    });
    const draft = bootstrap.posts.find(
      (post: { draft: boolean }) => post.draft,
    );
    const published = bootstrap.posts.find(
      (post: { draft: boolean }) => !post.draft,
    );
    draft.media = [media("draft-only", draft.folder)];
    published.media = [media("published", published.folder)];
    await route.fulfill({ response, json: bootstrap });
  });
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("button", { name: /Choose default social image/ })
    .click();
  const gallery = page.getByRole("dialog", {
    name: "Choose default social image",
  });

  await expect(gallery).toContainText("published");
  await expect(gallery).not.toContainText("draft-only");
});

test("keeps a saved image deletion when leaving and returning to Posts", async ({
  page,
}) => {
  await page.goto("/cms/");
  await page
    .getByRole("button", { name: /Welcome to the example blog/ })
    .click();
  await page.getByLabel("File manager").check();
  await page.getByLabel("Image 1 (required)", { exact: true }).setInputFiles({
    name: "navigation-regression.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" /></svg>',
    ),
  });
  await page
    .getByLabel("Alt text 1 (required)")
    .fill("Navigation regression image");
  await page.getByRole("button", { name: "Insert" }).click();
  const image = page.getByAltText("Navigation regression image");
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await image.click();
  await page.keyboard.press("Backspace");
  await expect(image).toHaveCount(0);
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  const saved = await page.request.get(
    "/api/local-cms/posts/26-07-26--welcome",
  );
  expect((await saved.json()).body).not.toContain(
    "Navigation regression image",
  );

  await page.getByRole("button", { name: "Media", exact: true }).click();
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  const afterNavigation = await page.request.get(
    "/api/local-cms/posts/26-07-26--welcome",
  );
  expect((await afterNavigation.json()).body).not.toContain(
    "Navigation regression image",
  );
  await expect(image).toHaveCount(0);
});
