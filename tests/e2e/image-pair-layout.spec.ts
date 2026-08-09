import { expect, test } from "./fixtures";

test("uses subgrid only while an image pair is side by side", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/posts/responsive-images-and-captions/");

  const pair = page.locator(".image-pair-individual");
  const firstFigure = pair.locator(".post-figure").first();
  await expect(firstFigure).toBeVisible();
  expect(
    await firstFigure.evaluate((figure) =>
      getComputedStyle(figure).gridTemplateRows.includes("subgrid"),
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 375, height: 667 });
  const mobileLayout = await firstFigure.evaluate((figure) => {
    const styles = getComputedStyle(figure);
    return {
      display: styles.display,
      row: styles.gridRow,
      rows: styles.gridTemplateRows,
    };
  });
  expect(mobileLayout).toEqual({ display: "block", row: "auto", rows: "none" });

  const firstImage = await firstFigure.locator("img").boundingBox();
  const firstCaption = await firstFigure.locator("figcaption").boundingBox();
  const secondImage = await pair
    .locator(".post-figure")
    .nth(1)
    .locator("img")
    .boundingBox();
  expect(firstImage).not.toBeNull();
  expect(firstCaption).not.toBeNull();
  expect(secondImage).not.toBeNull();
  expect(firstCaption!.y - (firstImage!.y + firstImage!.height)).toBeLessThan(
    16,
  );
  expect(
    secondImage!.y - (firstCaption!.y + firstCaption!.height),
  ).toBeLessThan(24);

  await page.goto("/cms/?view=posts&post=26-07-29--images-and-media");
  const editorFigure = page
    .locator(".visual-editor .image-pair-individual .post-figure")
    .first();
  await expect(editorFigure).toBeVisible();
  expect(
    await editorFigure.evaluate((figure) => {
      const styles = getComputedStyle(figure);
      return {
        display: styles.display,
        row: styles.gridRow,
        rows: styles.gridTemplateRows,
      };
    }),
  ).toEqual({ display: "block", row: "auto", rows: "none" });
});
