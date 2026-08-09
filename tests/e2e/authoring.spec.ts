import { expect, test } from "./fixtures";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import YAML from "yaml";

const run = promisify(execFile);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function expectAligned(actual: number, expected: number, tolerance = 2) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

async function acceptanceRoot() {
  return (
    await readFile(resolve(".astro", "acceptance-root.txt"), "utf8")
  ).trim();
}

async function artifactText(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return artifactText(path);
        if (/\.(?:html|xml|txt|js|css|json|svg)$/i.test(entry.name)) {
          return readFile(path, "utf8");
        }
        return "";
      }),
    )
  ).join("\n");
}

async function serveArtifact(directory: string) {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://artifact").pathname,
    );
    const wanted = resolve(directory, pathname.replace(/^\//, ""));
    const candidates = [wanted, resolve(wanted, "index.html")];
    let file = "";
    for (const candidate of candidates) {
      if ((await stat(candidate).catch(() => null))?.isFile()) {
        file = candidate;
        break;
      }
    }
    if (!file || !file.startsWith(directory)) {
      response.statusCode = 404;
      file = resolve(directory, "404.html");
    }
    const types: Record<string, string> = {
      ".html": "text/html",
      ".xml": "application/xml",
      ".txt": "text/plain",
      ".css": "text/css",
      ".js": "application/javascript",
      ".svg": "image/svg+xml",
      ".avif": "image/avif",
    };
    response.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  });
  await new Promise<void>((resolveReady) =>
    server.listen(4401, "127.0.0.1", resolveReady),
  );
  return server;
}

test("authors a post and settings through the local-only CMS", async ({
  page,
  browser,
}) => {
  await page.goto("/cms/");
  await expect(page.locator(".cms-brand")).toContainText("Example Blog");
  await expect(page.locator(".cms-brand")).toContainText("Editor");
  const cmsTheme = page.getByRole("group", { name: "Theme" });
  await expect(cmsTheme.getByLabel("System")).toBeChecked();
  const topbarBox = await page.locator(".topbar").boundingBox();
  const cmsThemeBox = await cmsTheme.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(cmsThemeBox).not.toBeNull();
  expectAligned(
    cmsThemeBox!.x + cmsThemeBox!.width,
    topbarBox!.x + topbarBox!.width - 16,
  );
  await cmsTheme.getByLabel("Dark").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(cmsTheme.getByLabel("Dark")).toBeChecked();
  await cmsTheme.getByLabel("System").check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await page.getByRole("button", { name: "New post" }).click();
  await expect(page.getByRole("heading", { name: "Untitled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create draft" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("tab", { name: "Visual" })).toBeVisible();
  await expect(page.getByLabel("Publish", { exact: true })).toBeDisabled();
  await expect(
    page.getByText("Save this Post before adding images."),
  ).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Acceptance note");
  await page.getByRole("button", { name: "What is a slug?" }).hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "The URL-friendly part after /posts/",
  );
  await page
    .getByRole("button", { name: "What is a Post description?" })
    .hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "social previews" }),
  ).toBeVisible();
  await page
    .getByLabel("Post description", { exact: true })
    .fill("Created through the browser acceptance seam.");
  await page.getByLabel("Slug", { exact: true }).fill("acceptance-note");
  await expect(page.getByLabel("Publish", { exact: true })).toBeEnabled();

  await page
    .getByRole("button", { name: "What is a Post description?" })
    .hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "Post body" }),
  ).toBeVisible();

  const titleBox = await page.locator(".post-title input").boundingBox();
  const descriptionBox = await page
    .locator(".post-description textarea")
    .boundingBox();
  const slugBox = await page.locator(".post-slug input").boundingBox();
  const tagsBox = await page.locator(".post-tags input").boundingBox();
  const publishedBox = await page
    .locator(".post-published input")
    .boundingBox();
  const updatedBox = await page.locator(".post-updated input").boundingBox();
  const socialBox = await page
    .getByRole("group", { name: "Social image" })
    .boundingBox();
  const aliasesBox = await page.locator(".post-aliases").boundingBox();
  expectAligned(titleBox!.x, descriptionBox!.x);
  expect(titleBox!.y).toBeLessThan(descriptionBox!.y);
  expectAligned(slugBox!.y, tagsBox!.y);
  expect(slugBox!.x).toBeLessThan(tagsBox!.x);
  expectAligned(publishedBox!.y, updatedBox!.y);
  expect(publishedBox!.x).toBeLessThan(updatedBox!.x);
  expectAligned(socialBox!.y, aliasesBox!.y);
  expect(socialBox!.x).toBeLessThan(aliasesBox!.x);
  await page.getByRole("button", { name: "What is a social image?" }).hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "preview image" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "What are aliases?" }).hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "Previous slugs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "How are images converted?" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Save, then “View post” for exact site rendering."),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Choose one image or a responsive pair/),
  ).toHaveCount(0);

  await expect(page.getByRole("tab", { name: "Visual" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  await page
    .getByLabel("Markdown and HTML source")
    .fill(
      "## Body heading\n\nThis was rendered with the production Markdown pipeline.",
    );
  await page.getByRole("tab", { name: "Visual" }).click();
  await expect(
    page.getByRole("heading", { name: "Body heading" }),
  ).toBeVisible();
  const visualBody = page.getByRole("textbox", { name: "Post body" });
  await visualBody.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Undoable marker");
  const undo = page.getByRole("button", { name: "Undo" });
  const redo = page.getByRole("button", { name: "Redo" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(visualBody).not.toContainText("Undoable marker");
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(visualBody).toContainText("Undoable marker");
  await undo.click();
  await page.getByLabel("Publish", { exact: true }).check();
  await expect(page.getByLabel("Draft", { exact: true })).not.toBeChecked();
  await expect(page.getByRole("link", { name: "View post" })).toHaveCount(0);
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.getByRole("button", { name: "How are images converted?" }).hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "non-upscaled AVIF" }),
  ).toBeVisible();
  const viewPost = page.getByRole("link", { name: "View post" });
  await expect(viewPost).toHaveAttribute("href", "/posts/acceptance-note/");
  await page.getByLabel("Slug", { exact: true }).fill("unsaved-slug");
  await expect(viewPost).toHaveAttribute("href", "/posts/acceptance-note/");
  await page.getByLabel("Slug", { exact: true }).fill("acceptance-note");
  const viewPostBox = await page
    .getByRole("link", { name: "View post" })
    .boundingBox();
  const publicationBox = await page
    .getByRole("group", { name: "Publication status" })
    .boundingBox();
  const saveBox = await page
    .getByRole("button", { name: /Save/ })
    .boundingBox();
  expect(viewPostBox!.x).toBeLessThan(publicationBox!.x);
  expect(publicationBox!.x).toBeLessThan(saveBox!.x);
  expectAligned(
    publicationBox!.y + publicationBox!.height / 2,
    saveBox!.y + saveBox!.height / 2,
  );
  const successToast = page.locator(".toast-success");
  const toastBox = await successToast.boundingBox();
  const viewport = page.viewportSize();
  expect(toastBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expectAligned(toastBox!.x + toastBox!.width, viewport!.width - 16);
  expect(toastBox!.y).toBeLessThan(100);
  await page.getByRole("button", { name: "Dismiss notice" }).click();
  await expect(successToast).not.toBeVisible();
  await expect(page.getByLabel("Published", { exact: true })).not.toHaveValue(
    "",
  );

  const root = await acceptanceRoot();
  await run("git", ["init"], { cwd: root });
  await run("git", ["add", "."], { cwd: root });
  await run(
    "git",
    [
      "-c",
      "user.name=Acceptance Test",
      "-c",
      "user.email=acceptance@example.test",
      "commit",
      "-m",
      "Published baseline",
    ],
    { cwd: root },
  );

  const initialFolders = await readdir(join(root, "content", "posts"));
  const initialAcceptanceFolder = initialFolders.find((value) =>
    value.endsWith("--acceptance-note"),
  );
  expect(initialAcceptanceFolder).toBeTruthy();
  const orphanPath = join(
    root,
    "content",
    "posts",
    initialAcceptanceFolder!,
    "orphan.svg",
  );
  await writeFile(
    orphanPath,
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>',
  );

  await page.goto("/posts/acceptance-note/");
  await expect(page.locator(".post-body img")).toHaveCount(0);
  await page.goto("/cms/");
  await page.getByRole("button", { name: "Media", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Media", exact: true }),
  ).toBeVisible();
  const orphanCard = page.locator("article").filter({ hasText: "orphan.svg" });
  await expect(orphanCard.locator(".media-static")).toBeVisible();
  const orphanCardBox = await orphanCard.boundingBox();
  const orphanImageBox = await orphanCard.locator("img").boundingBox();
  expect(orphanCardBox).not.toBeNull();
  expect(orphanImageBox).not.toBeNull();
  expect(orphanImageBox!.x).toBeGreaterThanOrEqual(orphanCardBox!.x);
  expect(orphanImageBox!.x + orphanImageBox!.width).toBeLessThanOrEqual(
    orphanCardBox!.x + orphanCardBox!.width,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await orphanCard
    .getByRole("button", { name: /Delete .*orphan\.svg/ })
    .click();
  await expect(page.getByText("Deleted orphan.svg")).toBeVisible();
  expect(await stat(orphanPath).catch(() => null)).toBeNull();
  const sharedSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12"><rect width="24" height="12" /></svg>',
  );
  await page.getByLabel("Choose global image").setInputFiles({
    name: "Shared Shape.svg",
    mimeType: "image/svg+xml",
    buffer: sharedSvg,
  });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported shared-shape.svg")).toBeVisible();
  const sharedPath = join(root, "content", "media", "shared-shape.svg");
  await expect(
    page.locator("article").filter({ hasText: "Shared / shared-shape.svg" }),
  ).toBeVisible();
  expect((await stat(sharedPath)).isFile()).toBe(true);
  await page.getByRole("button", { name: "Posts", exact: true }).click();
  await page.getByRole("button", { name: /Acceptance note/ }).click();
  await page.getByLabel("Media library").check();
  await expect(
    page.getByRole("group", { name: "Post media library" }),
  ).toContainText("shared-shape.svg");
  await page.getByLabel("File manager").check();
  const raster = await sharp({
    create: {
      width: 1000,
      height: 500,
      channels: 3,
      background: "#7b5cff",
    },
  })
    .png()
    .toBuffer();
  const portrait = await sharp({
    create: {
      width: 500,
      height: 1000,
      channels: 3,
      background: "#31a36b",
    },
  })
    .png()
    .toBuffer();
  const importButton = page.getByRole("button", { name: "Insert" });
  await expect(importButton).toBeEnabled();
  await expect(page.locator(".image-item-single")).toHaveCount(1);
  await importButton.click();
  const firstFileInput = page.getByLabel("Image 1 (required)", {
    exact: true,
  });
  await expect(firstFileInput).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Alt text 1 (required)")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(firstFileInput).toBeFocused();
  await page.getByLabel("Pair", { exact: true }).check();
  await firstFileInput.setInputFiles({
    name: "purple-field.png",
    mimeType: "image/png",
    buffer: raster,
  });
  await page.getByLabel("Alt text 1 (required)").fill("A purple field");
  await page.getByLabel("Image 2 (required)", { exact: true }).setInputFiles({
    name: "green-portrait.png",
    mimeType: "image/png",
    buffer: portrait,
  });
  await page.getByLabel("Alt text 2 (required)").fill("A green portrait");
  await expect(page.getByRole("group", { name: "Pair captions" })).toHaveCount(
    0,
  );
  await page.getByRole("switch", { name: "Individual captions" }).check();
  const firstCaption = page.getByLabel("Caption 1 (optional)");
  const secondCaption = page.getByLabel("Caption 2 (optional)");
  const firstCaptionBox = await firstCaption.boundingBox();
  const secondCaptionBox = await secondCaption.boundingBox();
  expect(firstCaptionBox).not.toBeNull();
  expect(secondCaptionBox).not.toBeNull();
  expectAligned(secondCaptionBox!.y, firstCaptionBox!.y);
  expectAligned(secondCaptionBox!.width, firstCaptionBox!.width);
  const captionToggleBox = await page
    .getByRole("switch", { name: "Individual captions" })
    .boundingBox();
  expect(captionToggleBox).not.toBeNull();
  expect(captionToggleBox!.y).toBeGreaterThan(
    firstCaptionBox!.y + firstCaptionBox!.height,
  );
  await firstCaption.fill("Purple study");
  await secondCaption.fill("Green study");
  await importButton.click();
  await expect(page.locator(".import-progress")).toContainText(
    /Converting — \d+%/,
  );
  const insertBox = await importButton.boundingBox();
  const progressBox = await page.locator(".import-progress").boundingBox();
  expect(insertBox).not.toBeNull();
  expect(progressBox).not.toBeNull();
  expectAligned(
    progressBox!.y + progressBox!.height / 2,
    insertBox!.y + insertBox!.height / 2,
  );
  expect(progressBox!.width).toBeGreaterThan(insertBox!.width);
  await expect(
    page.getByRole("progressbar", { name: "Converting images" }),
  ).toBeVisible();
  const editorLock = page.locator(".editor-lock");
  await expect(editorLock).toHaveAttribute("inert", "");
  await expect(page.locator(".editor-lock-frame")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(
    page.getByText("Editor locked until image import finishes."),
  ).toBeVisible();
  const lockBox = await editorLock.boundingBox();
  const lockMessageBox = await page
    .locator(".editor-lock-overlay span")
    .boundingBox();
  expect(lockBox).not.toBeNull();
  expect(lockMessageBox).not.toBeNull();
  expectAligned(
    lockMessageBox!.x + lockMessageBox!.width / 2,
    lockBox!.x + lockBox!.width / 2,
  );
  expectAligned(
    lockMessageBox!.y + lockMessageBox!.height / 2,
    lockBox!.y + lockBox!.height / 2,
  );
  const visualPair = page.locator(".visual-editor .image-pair");
  await expect(visualPair).toBeVisible();
  await expect(editorLock).not.toHaveAttribute("inert", "");
  await expect.soft(firstFileInput).toHaveValue("");
  await expect(visualPair.locator("img")).toHaveCount(2);
  await expect(visualPair.getByAltText("A green portrait")).toBeVisible();
  await expect(page.locator(".visual-editor figcaption")).toHaveText([
    "Purple study",
    "Green study",
  ]);
  await expect(visualPair).toHaveClass(/\bimage-pair-individual\b/);
  expect(
    await page
      .locator(".visual-editor .image-pair-individual figcaption")
      .first()
      .evaluate((caption) => getComputedStyle(caption).marginTop),
  ).toBe("0px");
  await page.getByRole("button", { name: "Choose social image" }).click();
  const socialImageDialog = page.getByRole("dialog", {
    name: "Choose social image",
  });
  await expect(socialImageDialog).toBeVisible();
  await expect(socialImageDialog.locator(".media-card").first()).toContainText(
    "Use site default",
  );
  await expect(
    socialImageDialog.locator(".media-card").first().locator(".media-select"),
  ).toBeVisible();
  await expect(
    socialImageDialog.getByRole("button", { name: /^Delete / }),
  ).toHaveCount(0);
  await socialImageDialog.getByRole("button", { name: /purple-field/ }).click();
  await expect(socialImageDialog).not.toBeVisible();
  const visualImage = page.locator('.visual-editor img[alt="A purple field"]');
  await expect(visualImage).toBeVisible();
  const ratios = await visualImage.evaluate(async (image) => {
    const raster = image as HTMLImageElement;
    await raster.decode();
    const box = raster.getBoundingClientRect();
    return {
      rendered: box.width / box.height,
      natural: raster.naturalWidth / raster.naturalHeight,
    };
  });
  expect(ratios.rendered).toBeCloseTo(ratios.natural, 2);
  await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Updated")).not.toHaveValue("");

  await page.reload();
  await page.getByRole("button", { name: /Acceptance note/ }).click();
  await expect(visualPair.locator("img")).toHaveCount(2);
  await expect(visualPair).toHaveClass(/\bimage-pair-individual\b/);
  await visualImage.click();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(visualPair.locator("img")).toHaveCount(2);
  await visualImage.click();
  await page.keyboard.press("Backspace");
  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  const sourceAfterDelete = await page
    .getByLabel("Markdown and HTML source")
    .inputValue();
  const emptyImages = [...sourceAfterDelete.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => !/\bsrc="[^"]+"/i.test(tag));
  expect.soft(emptyImages).toEqual([]);
  await page.getByLabel("Media library").check();
  const purpleMedia = page
    .getByRole("group", { name: "Post media library" })
    .locator(".media-card")
    .filter({ hasText: "purple-field" });
  await purpleMedia.locator(".media-select").click();
  await page.getByLabel("Alt text 1 (required)").fill("Reused purple field");
  await page.getByRole("button", { name: "Insert" }).click();
  await expect(page.getByLabel("Markdown and HTML source")).toHaveValue(
    /alt="Reused purple field"/,
  );
  await page.reload();
  await page.getByRole("button", { name: /Acceptance note/ }).click();
  await expect(visualPair.locator("img")).toHaveCount(2);

  await page.goto("/posts/acceptance-note/");
  await expect(page.getByRole("link", { name: "Posts" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const publishedPair = page.locator(".post-body .image-pair");
  await expect(publishedPair.getByAltText("A purple field")).toBeVisible();
  await expect(publishedPair.getByAltText("A green portrait")).toBeVisible();
  await expect(publishedPair.locator("img")).toHaveCount(2);
  await expect(publishedPair.locator("figcaption")).toHaveText([
    "Purple study",
    "Green study",
  ]);
  await page.goto("/cms/");
  await page.getByRole("button", { name: /Acceptance note/ }).click();
  await expect(page.getByTestId("recovery-panel")).toHaveCount(0);
  await page
    .getByLabel("Slug", { exact: true })
    .fill("acceptance-note-updated");
  page.once("dialog", (dialog) => dialog.accept());
  const slugSave = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/api/local-cms/posts/"),
  );
  await page.getByRole("button", { name: /Save/ }).click();
  await slugSave;
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByLabel("Updated")).not.toHaveValue("");

  await page.getByRole("tab", { name: "Markdown / HTML" }).click();
  const sourceEditor = page.getByLabel("Markdown and HTML source");
  await sourceEditor.fill(
    `${await sourceEditor.inputValue()}\n\nUnsaved CMS version.`,
  );
  await expect(page.getByRole("button", { name: /Save/ })).toBeEnabled();
  const folders = await readdir(join(root, "content", "posts"));
  const acceptanceFolder = folders.find((value) =>
    value.endsWith("--acceptance-note"),
  );
  expect(acceptanceFolder).toBeTruthy();
  const sourcePath = join(
    root,
    "content",
    "posts",
    acceptanceFolder!,
    "index.md",
  );
  await writeFile(
    sourcePath,
    `${await readFile(sourcePath, "utf8")}\n\nExternal version.\n`,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("This file changed outside the CMS."),
  ).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Reload external version" }).click();
  await page.getByRole("tab", { name: "Visual" }).click();
  await expect(
    page.getByText("External version.", { exact: true }),
  ).toBeVisible();

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Acceptance note" }),
  ).toBeVisible();
  const postsNavigation = page.getByRole("link", {
    name: "Posts",
    exact: true,
  });
  await expect(postsNavigation).toHaveAttribute("aria-current", "page");

  await page.goto("/cms/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("button", { name: "What is the Site description?" })
    .hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "Posts use their own" }),
  ).toBeVisible();
  const initialSettings = YAML.parse(
    await readFile(join(root, "site.config.yaml"), "utf8"),
  ) as { accentColor: string };
  const initialAccent = initialSettings.accentColor.toLowerCase();
  const testAccent = initialAccent === "#24837b" ? "#bc5215" : "#24837b";
  const accentPicker = page.getByLabel("Accent color");
  await expect(accentPicker).toHaveValue(initialAccent);
  await accentPicker.fill(testAccent);
  await page
    .getByRole("button", { name: /Choose default social image/ })
    .click();
  const defaultSocialDialog = page.getByRole("dialog", {
    name: "Choose default social image",
  });
  await expect(defaultSocialDialog).toContainText("Shared / shared-shape.svg");
  await defaultSocialDialog
    .getByRole("button", { name: /Shared \/ shared-shape\.svg/ })
    .click();
  await expect(defaultSocialDialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /Choose default social image/ }),
  ).toContainText("Shared / shared-shape.svg");
  await page.getByRole("button", { name: "Add social link" }).click();
  await page.getByLabel("Social 1 link name").fill("Example social link");
  await page.getByLabel("Social 1 URL").fill("https://example.com/social");
  await expect(page.getByLabel("Social 1 icon")).toHaveValue("auto");
  await page.getByLabel("Allow search indexing").uncheck();
  await expect(page.getByText(/Disallow: \//)).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  const savedSettings = YAML.parse(
    await readFile(join(root, "site.config.yaml"), "utf8"),
  ) as { accentColor: string };
  expect(savedSettings.accentColor).toBe(testAccent.toUpperCase());
  await page.goto("/robots.txt");
  await expect(page.locator("body")).toContainText("Disallow: /");

  await writeFile(
    join(root, "content", "media", "unused-shared.svg"),
    sharedSvg,
  );

  await run(npmCommand, ["run", "build"], { cwd: root, timeout: 60_000 });
  const dist = resolve(root, "dist");
  const artifact = await artifactText(dist);
  expect(artifact).toContain("Acceptance note");
  expect(artifact).not.toContain("A private sample draft");
  expect(artifact).not.toContain("This body must never appear");
  expect(artifact).not.toContain('href="/cms/"');
  expect(artifact).not.toContain("/api/local-cms/");
  expect(artifact).not.toContain(root);
  expect(
    (await stat(join(dist, "media", "shared", "shared-shape.svg"))).isFile(),
  ).toBe(true);
  expect(
    await stat(join(dist, "media", "shared", "unused-shared.svg")).catch(
      () => null,
    ),
  ).toBeNull();
  expect(await readFile(resolve(dist, "_redirects"), "utf8")).toContain(
    "/posts/acceptance-note/ /posts/acceptance-note-updated/ 301",
  );

  const artifactServer = await serveArtifact(dist);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("http://127.0.0.1:4401/posts/acceptance-note-updated/");
    await expect(
      page.getByRole("heading", { name: "Acceptance note" }),
    ).toBeVisible();
    const artifactPair = page.locator(".post-body .image-pair");
    const firstImage = artifactPair.getByAltText("A purple field");
    const secondImage = artifactPair.getByAltText("A green portrait");
    await expect(firstImage).toBeVisible();
    await expect(secondImage).toBeVisible();
    await expect(artifactPair.locator("figcaption")).toHaveText([
      "Purple study",
      "Green study",
    ]);
    const socialLink = page.getByRole("link", {
      name: "Example social link",
    });
    await expect(socialLink.locator("svg")).toBeVisible();
    const desktopFirst = await firstImage.boundingBox();
    const desktopSecond = await secondImage.boundingBox();
    expect(desktopFirst).not.toBeNull();
    expect(desktopSecond).not.toBeNull();
    expectAligned(
      desktopSecond!.y + desktopSecond!.height / 2,
      desktopFirst!.y + desktopFirst!.height / 2,
    );

    await page.setViewportSize({ width: 360, height: 720 });
    const mobileFirst = await firstImage.boundingBox();
    const mobileSecond = await secondImage.boundingBox();
    const mobileFirstCaption = await artifactPair
      .locator("figcaption")
      .first()
      .boundingBox();
    expect(mobileFirst).not.toBeNull();
    expect(mobileSecond).not.toBeNull();
    expect(mobileFirstCaption).not.toBeNull();
    expect(
      mobileFirstCaption!.y - (mobileFirst!.y + mobileFirst!.height),
    ).toBeLessThanOrEqual(20);
    expect(mobileSecond!.y).toBeGreaterThan(
      mobileFirst!.y + mobileFirst!.height,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    const durableContext = await browser.newContext({
      javaScriptEnabled: false,
      colorScheme: "dark",
      reducedMotion: "reduce",
      viewport: { width: 360, height: 720 },
    });
    const durablePage = await durableContext.newPage();
    await durablePage.goto("http://127.0.0.1:4401/");
    await expect(
      durablePage.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    expect(
      await durablePage.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
    ).toBe("rgb(16, 15, 15)");
    expect(
      await durablePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await durableContext.close();
  } finally {
    await new Promise<void>((resolveClosed) =>
      artifactServer.close(() => resolveClosed()),
    );
  }
});

test("published pages remain useful without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "RSS", exact: true }).locator("svg"),
  ).toBeVisible();
  await expect(page.locator(".post-list")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Welcome to the example blog" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Welcome to the example blog" }).click();
  const cmsLink = page.getByRole("link", {
    name: "development-only authoring tool",
  });
  await expect(cmsLink).toHaveAttribute("href", "/cms/");
  const resolvedCmsUrl = new URL(
    (await cmsLink.getAttribute("href"))!,
    page.url(),
  );
  expect(resolvedCmsUrl.origin).toBe(new URL(page.url()).origin);
  expect(resolvedCmsUrl.pathname).toBe("/cms/");
  await context.close();
});

test("offers persistent light, dark, and system themes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  const theme = page.getByRole("group", { name: "Theme" });
  await expect(theme.getByLabel("System")).toBeChecked();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor,
    ),
  ).toBe("rgb(16, 15, 15)");

  const headerBox = await page.locator(".site-header").boundingBox();
  const themeBox = await theme.boundingBox();
  expect(headerBox).not.toBeNull();
  expect(themeBox).not.toBeNull();
  expectAligned(themeBox!.x + themeBox!.width, headerBox!.x + headerBox!.width);

  await theme.getByLabel("Light").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(theme.getByLabel("Light")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await theme.getByLabel("Dark").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await theme.getByLabel("System").check();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});
