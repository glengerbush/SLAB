import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";

import {
  deleteSharedMedia,
  deletePostMedia,
  importSharedImages,
  importPostImage,
  importPostImages,
  insertPostMedia,
  listPostMedia,
  listSharedMedia,
} from "../src/cms/images";
import { deletePersistedPostMedia } from "../src/cms/media-deletion";
import { createPost } from "../src/cms/repository";

test("creates responsive AVIF variants without retaining or upscaling the original", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const source = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: "#7b5cff" },
  })
    .png()
    .toBuffer();

  const result = await importPostImage(root, folder, {
    filename: "Purple Field.png",
    mimeType: "image/png",
    base64: source.toString("base64"),
    alt: "A flat purple field",
  });

  expect(
    (await readdir(join(root, "content", "posts", folder))).sort(),
  ).toEqual(["purple-field-480.avif", "purple-field-960.avif"]);
  expect(result.markup).toContain('alt="A flat purple field"');
  expect(result.markup).toContain('title="A flat purple field"');
  expect(result.markup).toContain('width="1000" height="500"');
  expect(result.markup).not.toContain("1600w");
  expect(result.markup).not.toContain(".png");
  expect(await listPostMedia(root, folder)).toEqual([
    expect.objectContaining({
      id: "purple-field-960.avif",
      name: "purple-field",
      kind: "raster",
      files: ["purple-field-480.avif", "purple-field-960.avif"],
      src: `/media/${folder}/purple-field-960.avif`,
      srcset: expect.stringContaining("purple-field-480.avif 480w"),
    }),
  ]);
});

test.skipIf(process.platform === "win32")(
  "rejects a symlinked posts ancestor before importing outside the repository",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "blog-images-"));
    const outside = await mkdtemp(join(tmpdir(), "blog-images-outside-"));
    const folder = "26-08-06--escaped-image";
    await mkdir(join(root, "content"));
    await mkdir(join(outside, folder));
    await symlink(outside, join(root, "content", "posts"));
    const source = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#7b5cff" },
    })
      .png()
      .toBuffer();

    await expect(
      importPostImage(root, folder, {
        filename: "Escaped.png",
        mimeType: "image/png",
        base64: source.toString("base64"),
        alt: "Escaped image",
      }),
    ).rejects.toThrow(/real directory/i);
    expect(await readdir(join(outside, folder))).toEqual([]);
  },
);

test("uses EXIF-oriented dimensions for raster markup and descriptors", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--oriented-image";
  const directory = join(root, "content", "posts", folder);
  await mkdir(directory, { recursive: true });
  const source = await sharp({
    create: { width: 80, height: 40, channels: 3, background: "#7b5cff" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

  const result = await importPostImage(root, folder, {
    filename: "Rotated.jpg",
    mimeType: "image/jpeg",
    base64: source.toString("base64"),
    alt: "A portrait after orientation",
  });

  expect(result.markup).toContain('width="40" height="80"');
  expect(result.markup).toContain("rotated-40.avif 40w");
  const output = await sharp(join(directory, "rotated-40.avif")).metadata();
  expect({ width: output.width, height: output.height }).toEqual({
    width: 40,
    height: 80,
  });
});

test("requires alt text and preserves safe SVG files", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';

  await expect(
    importPostImage(root, folder, {
      filename: "shape.svg",
      mimeType: "image/svg+xml",
      base64: Buffer.from(svg).toString("base64"),
      alt: "",
    }),
  ).rejects.toThrow(/alt/i);

  const result = await importPostImage(root, folder, {
    filename: "shape.svg",
    mimeType: "image/svg+xml",
    base64: Buffer.from(svg).toString("base64"),
    alt: "Simple rectangle",
  });
  expect(await readdir(join(root, "content", "posts", folder))).toEqual([
    "shape.svg",
  ]);
  expect(result.markup).toContain('alt="Simple rectangle"');
  expect(result.markup).toContain('title="Simple rectangle"');
});

test("lists the most recently imported media first", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  const directory = join(root, "content", "posts", folder);
  await mkdir(directory, { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';

  for (const filename of ["older.svg", "newer.svg"]) {
    await importPostImage(root, folder, {
      filename,
      mimeType: "image/svg+xml",
      base64: Buffer.from(svg).toString("base64"),
      alt: filename,
    });
  }
  await utimes(
    join(directory, "older.svg"),
    new Date("2026-08-01"),
    new Date("2026-08-01"),
  );
  await utimes(
    join(directory, "newer.svg"),
    new Date("2026-08-02"),
    new Date("2026-08-02"),
  );

  expect((await listPostMedia(root, folder)).map((asset) => asset.id)).toEqual([
    "newer.svg",
    "older.svg",
  ]);
});

test("adds one optional caption to a single image", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';

  const result = await importPostImages(root, folder, {
    layout: "single",
    caption: { type: "shared", text: "Shape <study>" },
    images: [
      {
        filename: "shape.svg",
        mimeType: "image/svg+xml",
        base64: Buffer.from(svg).toString("base64"),
        alt: "Simple rectangle",
      },
    ],
  });

  expect(result.markup).toMatch(/^<figure class="post-figure">/);
  expect(result.markup).toContain(
    "<figcaption>Shape &lt;study&gt;</figcaption>",
  );
});

test("reuses and safely deletes an imported media asset", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';
  await importPostImage(root, folder, {
    filename: "shape.svg",
    mimeType: "image/svg+xml",
    base64: Buffer.from(svg).toString("base64"),
    alt: "Original description",
  });

  const inserted = await insertPostMedia(root, folder, {
    layout: "single",
    assets: [{ id: "shape.svg", scope: "post" }],
    alts: ["Reused shape"],
    caption: { type: "shared", text: "Again" },
  });
  expect(inserted.markup).toContain(
    'src="/media/26-08-06--image-post/shape.svg"',
  );
  expect(inserted.markup).toContain('alt="Reused shape"');
  expect(inserted.markup).toContain("<figcaption>Again</figcaption>");

  await expect(
    deletePostMedia(root, folder, {
      assetId: "shape.svg",
      references: [inserted.markup],
    }),
  ).rejects.toThrow(/every saved reference/i);
  await expect(
    deletePostMedia(root, folder, {
      assetId: "shape.svg",
      references: [`/media/${folder}/shape.svg`],
    }),
  ).rejects.toThrow(/every saved reference/i);

  const deleted = await deletePostMedia(root, folder, {
    assetId: "shape.svg",
    references: [],
  });
  expect(deleted.deleted).toEqual(["shape.svg"]);
  expect(deleted.media).toEqual([]);
  expect(await readdir(join(root, "content", "posts", folder))).toEqual([]);
});

test("rolls back every media variant when group deletion fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--rollback-image";
  const directory = join(root, "content", "posts", folder);
  await mkdir(directory, { recursive: true });
  const source = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: "#7b5cff" },
  })
    .png()
    .toBuffer();
  const imported = await importPostImage(root, folder, {
    filename: "Rollback.png",
    mimeType: "image/png",
    base64: source.toString("base64"),
    alt: "Rollback test",
  });
  const originalBytes = await Promise.all(
    imported.files.map((file) => readFile(join(directory, file))),
  );
  let quarantineMoves = 0;

  await expect(
    deletePostMedia(
      root,
      folder,
      { assetId: imported.files.at(-1)!, references: [] },
      {
        mkdir,
        rm,
        rename: async (sourcePath, destinationPath) => {
          if (
            String(destinationPath).includes(".media-delete-") &&
            ++quarantineMoves === 2
          )
            throw new Error("Injected quarantine move failure");
          await rename(sourcePath, destinationPath);
        },
      },
    ),
  ).rejects.toThrow(/injected quarantine move failure/i);

  expect((await readdir(directory)).sort()).toEqual(imported.files.sort());
  expect(
    await Promise.all(
      imported.files.map((file) => readFile(join(directory, file))),
    ),
  ).toEqual(originalBytes);
});

test("authoritatively protects Post Media referenced anywhere on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  await mkdir(join(root, "content", "posts"), { recursive: true });
  await copyFile(resolve("site.config.yaml"), join(root, "site.config.yaml"));
  const owner = await createPost(
    root,
    { title: "Owner", description: "Owner post", slug: "owner" },
    new Date("2026-08-01T12:00:00Z"),
  );
  const other = await createPost(
    root,
    { title: "Other", description: "Other post", slug: "other" },
    new Date("2026-08-02T12:00:00Z"),
  );
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';
  await importPostImage(root, owner.folder, {
    filename: "shape.svg",
    mimeType: "image/svg+xml",
    base64: Buffer.from(svg).toString("base64"),
    alt: "Shape",
  });
  const mediaPath = `/media/${owner.folder}/shape.svg`;
  const otherPath = join(root, "content", "posts", other.folder, "index.md");
  const otherSource = await readFile(otherPath, "utf8");
  await writeFile(
    otherPath,
    `${otherSource}\n<img src="${mediaPath}" alt="Shape">\n`,
  );

  await expect(
    deletePersistedPostMedia(root, owner.folder, "shape.svg"),
  ).rejects.toThrow(/every saved reference/i);

  await writeFile(otherPath, otherSource);
  const settingsPath = join(root, "site.config.yaml");
  const settings = await readFile(settingsPath, "utf8");
  await writeFile(
    settingsPath,
    settings.replace(
      "defaultSocialImage: null",
      `defaultSocialImage: ${mediaPath}`,
    ),
  );
  await expect(
    deletePersistedPostMedia(root, owner.folder, "shape.svg"),
  ).rejects.toThrow(/every saved reference/i);

  await writeFile(settingsPath, settings);
  const deleted = await deletePersistedPostMedia(
    root,
    owner.folder,
    "shape.svg",
  );
  expect(deleted.deleted).toEqual(["shape.svg"]);
});

test("imports global media, reuses it across posts, and protects references", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" /></svg>';

  const imported = await importSharedImages(root, [
    {
      filename: "Shared Shape.svg",
      mimeType: "image/svg+xml",
      base64: Buffer.from(svg).toString("base64"),
      alt: "",
    },
  ]);
  expect(imported.media).toEqual([
    expect.objectContaining({
      scope: "shared",
      id: "shared-shape.svg",
      src: "/media/shared/shared-shape.svg",
    }),
  ]);
  expect(await listSharedMedia(root)).toHaveLength(1);

  const inserted = await insertPostMedia(root, folder, {
    layout: "single",
    assets: [{ id: "shared-shape.svg", scope: "shared" }],
    alts: ["Reusable shape"],
  });
  expect(inserted.markup).toContain('src="/media/shared/shared-shape.svg"');

  await expect(
    deleteSharedMedia(root, {
      assetId: "shared-shape.svg",
      references: [inserted.markup],
    }),
  ).rejects.toThrow(/every reference/i);
  const deleted = await deleteSharedMedia(root, {
    assetId: "shared-shape.svg",
    references: [],
  });
  expect(deleted.media).toEqual([]);
});

test("rejects missing alt text without exposing a trim error", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });

  await expect(
    importPostImages(root, folder, {
      layout: "single",
      images: [
        {
          filename: "Stale.png",
          mimeType: "image/png",
          base64: "unused",
          alt: undefined as unknown as string,
        },
      ],
    }),
  ).rejects.toThrow("Each image requires alt text");
});

test("imports two images as one responsive pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const first = await sharp({
    create: { width: 1000, height: 500, channels: 3, background: "#7b5cff" },
  })
    .png()
    .toBuffer();
  const second = await sharp({
    create: { width: 500, height: 1000, channels: 3, background: "#31a36b" },
  })
    .png()
    .toBuffer();

  const progress: Array<{ completed: number; total: number }> = [];
  const result = await importPostImages(
    root,
    folder,
    {
      layout: "pair",
      caption: {
        type: "individual",
        texts: ["Purple study", "Green study"],
      },
      images: [
        {
          filename: "Purple.png",
          mimeType: "image/png",
          base64: first.toString("base64"),
          alt: "Purple landscape",
        },
        {
          filename: "Green.png",
          mimeType: "image/png",
          base64: second.toString("base64"),
          alt: "Green portrait",
        },
      ],
    },
    (update) => progress.push(update),
  );

  expect(result.files).toHaveLength(3);
  expect(progress).toEqual([
    { completed: 0, total: 3 },
    { completed: 1, total: 3 },
    { completed: 2, total: 3 },
    { completed: 3, total: 3 },
  ]);
  expect(result.markup).toMatch(
    /^<div class="image-pair image-pair-individual">/,
  );
  expect(result.markup.match(/<figure class="post-figure">/g)).toHaveLength(2);
  expect(result.markup).toContain('alt="Purple landscape"');
  expect(result.markup).toContain('alt="Green portrait"');
  expect(result.markup).toContain("<figcaption>Purple study</figcaption>");
  expect(result.markup).toContain("<figcaption>Green study</figcaption>");
  expect(result.markup).toContain(
    'sizes="(max-width: 38rem) calc(100vw - 2rem), 35ch"',
  );
});

test("adds one shared caption to an image pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  await mkdir(join(root, "content", "posts", folder), { recursive: true });
  const svg = (fill: string) =>
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="${fill}" /></svg>`,
    ).toString("base64");

  const result = await importPostImages(root, folder, {
    layout: "pair",
    caption: { type: "shared", text: "Two shapes" },
    images: [
      {
        filename: "first.svg",
        mimeType: "image/svg+xml",
        base64: svg("purple"),
        alt: "Purple shape",
      },
      {
        filename: "second.svg",
        mimeType: "image/svg+xml",
        base64: svg("green"),
        alt: "Green shape",
      },
    ],
  });

  expect(result.markup).toMatch(/^<figure class="post-figure">/);
  expect(result.markup).toContain('<div class="image-pair">');
  expect(result.markup).toContain("<figcaption>Two shapes</figcaption>");
});

test("rolls back a partially failed pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-images-"));
  const folder = "26-08-06--image-post";
  const directory = join(root, "content", "posts", folder);
  await mkdir(directory, { recursive: true });
  const valid = await sharp({
    create: { width: 500, height: 500, channels: 3, background: "#7b5cff" },
  })
    .png()
    .toBuffer();

  await expect(
    importPostImages(root, folder, {
      layout: "pair",
      images: [
        {
          filename: "Valid.png",
          mimeType: "image/png",
          base64: valid.toString("base64"),
          alt: "Valid",
        },
        {
          filename: "Broken.png",
          mimeType: "image/png",
          base64: Buffer.from("not an image").toString("base64"),
          alt: "Broken",
        },
      ],
    }),
  ).rejects.toThrow();
  expect(await readdir(directory)).toEqual([]);
});
