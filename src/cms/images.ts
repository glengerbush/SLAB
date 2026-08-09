import { randomUUID } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import sharp from "sharp";

import type { MediaAsset } from "../lib/cms-contracts";
import { assertPostFolderName, fileLabel } from "../lib/post-policy";
import { resolveRealDirectory } from "./filesystem";

const rasterTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/tiff",
]);

export interface ImageImportInput {
  filename: string;
  mimeType: string;
  base64: string;
  alt: string;
}

export type ImageLayout = "single" | "pair";

export interface MediaFileOperations {
  mkdir: typeof mkdir;
  rename: typeof rename;
  rm: typeof rm;
}

const mediaFileOperations: MediaFileOperations = { mkdir, rename, rm };

export type ImageCaptionInput =
  | { type: "shared"; text: string }
  | { type: "individual"; texts: [string, string] };

export interface PostImagesImportInput {
  layout: ImageLayout;
  images: ImageImportInput[];
  caption?: ImageCaptionInput;
}

export interface ExistingPostImagesInput {
  layout: ImageLayout;
  assets: Array<{ id: string; scope: "post" | "shared" }>;
  alts: string[];
  caption?: ImageCaptionInput;
}

export interface ImageConversionProgress {
  completed: number;
  total: number;
}

type PreparedImage =
  | { kind: "svg"; buffer: Buffer; source: string }
  | {
      kind: "raster";
      buffer: Buffer;
      width: number;
      height: number;
      widths: number[];
    };

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function captioned(
  markup: string,
  caption: string | undefined,
  always = false,
) {
  const text = typeof caption === "string" ? caption.trim() : "";
  if (!text && !always) return markup;
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const figcaption = text ? `\n<figcaption>${escaped}</figcaption>` : "";
  return `<figure class="post-figure">\n${markup}${figcaption}\n</figure>`;
}

function imageAlt(
  input: ImageImportInput,
  errorMessage = "Alt text is required",
) {
  const alt = typeof input.alt === "string" ? input.alt.trim() : "";
  if (!alt) throw new Error(errorMessage);
  return alt;
}

async function uniqueBase(
  directory: string,
  wanted: string,
  extension: string,
) {
  let value = wanted;
  let suffix = 2;
  while (
    await access(resolve(directory, `${value}${extension}`)).then(
      () => true,
      () => false,
    )
  ) {
    value = `${wanted}-${suffix++}`;
  }
  return value;
}

async function atomicBuffer(path: string, buffer: Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer, { flag: "wx" });
  await rename(temporary, path);
}

async function imageDirectory(root: string, folder: string) {
  assertPostFolderName(folder);
  if (basename(folder) !== folder) throw new Error("Invalid post folder");
  return resolveRealDirectory(root, ["content", "posts", folder]);
}

function sharedImageDirectory(root: string, allowMissingLeaf = false) {
  return resolveRealDirectory(root, ["content", "media"], {
    allowMissingLeaf,
  });
}

async function realMediaFiles(directory: string, missingIsEmpty = false) {
  const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (missingIsEmpty && error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return [];
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Media folder must be a real directory");
  const names = (await readdir(directory)).filter((name) =>
    /\.(?:avif|svg)$/i.test(name),
  );
  const files: { name: string; importedAt: string }[] = [];
  for (const name of names) {
    if (basename(name) !== name) continue;
    const file = await lstat(resolve(directory, name));
    if (file.isFile() && !file.isSymbolicLink())
      files.push({ name, importedAt: file.mtime.toISOString() });
  }
  return files.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listPostMedia(
  root: string,
  folder: string,
): Promise<MediaAsset[]> {
  return listMediaDirectory(await imageDirectory(root, folder), folder, "post");
}

export async function listSharedMedia(root: string): Promise<MediaAsset[]> {
  return listMediaDirectory(
    await sharedImageDirectory(root, true),
    "shared",
    "shared",
    true,
  );
}

async function listMediaDirectory(
  directory: string,
  publicFolder: string,
  scope: MediaAsset["scope"],
  missingIsEmpty = false,
): Promise<MediaAsset[]> {
  const files = await realMediaFiles(directory, missingIsEmpty);
  const groups = new Map<string, typeof files>();
  for (const file of files) {
    const variant = file.name.match(/^(.*)-(\d+)\.avif$/i);
    const key = variant ? `raster:${variant[1]}` : `file:${file.name}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const assets = await Promise.all(
    [...groups.entries()].map(async ([key, grouped]) => {
      const variants = grouped
        .map((file) => ({
          ...file,
          file: file.name,
          width: Number(file.name.match(/-(\d+)\.avif$/i)?.[1]) || 0,
        }))
        .sort((left, right) => left.width - right.width);
      const primary = variants.at(-1)!.file;
      const path = resolve(directory, primary);
      const metadata = await sharp(path).metadata();
      const raster = key.startsWith("raster:");
      const name = raster ? key.slice("raster:".length) : primary;
      return {
        scope,
        id: primary,
        name,
        importedAt: variants
          .map((variant) => variant.importedAt)
          .sort()
          .at(-1)!,
        kind: raster ? ("raster" as const) : ("svg" as const),
        files: variants.map((variant) => variant.file),
        src: `/media/${publicFolder}/${primary}`,
        ...(raster
          ? {
              srcset: variants
                .map(
                  (variant) =>
                    `/media/${publicFolder}/${variant.file} ${variant.width}w`,
                )
                .join(", "),
            }
          : {}),
        ...(metadata.width && metadata.height
          ? { width: metadata.width, height: metadata.height }
          : {}),
      } satisfies MediaAsset;
    }),
  );
  return assets.sort(
    (left, right) =>
      right.importedAt.localeCompare(left.importedAt) ||
      left.name.localeCompare(right.name),
  );
}

function svgSize(source: string) {
  const width = Number(source.match(/\bwidth=["'](\d+(?:\.\d+)?)/i)?.[1]);
  const height = Number(source.match(/\bheight=["'](\d+(?:\.\d+)?)/i)?.[1]);
  const viewBox = source.match(
    /\bviewBox=["'][^"']*?([\d.]+)[ ,]+([\d.]+)["']/i,
  );
  return {
    width: width || Number(viewBox?.[1]) || undefined,
    height: height || Number(viewBox?.[2]) || undefined,
  };
}

async function prepareImage(input: ImageImportInput): Promise<PreparedImage> {
  if (input.base64.length > 34_000_000)
    throw new Error("Image payload is too large");
  const buffer = Buffer.from(input.base64, "base64");
  if (
    input.mimeType === "image/svg+xml" ||
    extname(input.filename).toLowerCase() === ".svg"
  ) {
    const source = buffer.toString("utf8");
    if (
      !/^\s*<svg\b/i.test(source) ||
      /<script\b|\son[a-z]+\s*=|javascript\s*:/i.test(source)
    ) {
      throw new Error("SVG contains executable or invalid content");
    }
    return { kind: "svg", buffer, source };
  }
  if (!rasterTypes.has(input.mimeType))
    throw new Error("Unsupported raster image type");
  const metadata = await sharp(buffer, { failOn: "error" }).rotate().metadata();
  const dimensions = metadata.autoOrient ?? metadata;
  if (!dimensions.width || !dimensions.height)
    throw new Error("Image dimensions could not be read");
  const widths = [480, 960, 1600].filter((width) => width <= dimensions.width!);
  if (!widths.length) widths.push(dimensions.width);
  return {
    kind: "raster",
    buffer,
    width: dimensions.width,
    height: dimensions.height,
    widths,
  };
}

async function writePreparedMedia(
  directory: string,
  publicFolder: string,
  input: ImageImportInput,
  prepared: PreparedImage,
  onUnit?: () => void,
) {
  const alt = imageAlt(input);
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Post folder must be a real directory");

  if (prepared.kind === "svg") {
    const base = await uniqueBase(
      directory,
      fileLabel(basename(input.filename, extname(input.filename)), "image"),
      ".svg",
    );
    const filename = `${base}.svg`;
    await atomicBuffer(resolve(directory, filename), prepared.buffer);
    onUnit?.();
    const size = svgSize(prepared.source);
    const dimensions =
      size.width && size.height
        ? ` width="${size.width}" height="${size.height}"`
        : "";
    return {
      files: [filename],
      markup: `<img src="/media/${publicFolder}/${filename}" alt="${escapeAttribute(alt)}" title="${escapeAttribute(alt)}"${dimensions}>`,
    };
  }

  const largest = prepared.widths.at(-1)!;
  const base = await uniqueBase(
    directory,
    fileLabel(basename(input.filename, extname(input.filename)), "image"),
    `-${largest}.avif`,
  );
  const variants = await Promise.allSettled(
    prepared.widths.map(async (width) => {
      const filename = `${base}-${width}.avif`;
      const output = await sharp(prepared.buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .avif({ quality: 68, effort: 6 })
        .toBuffer();
      await atomicBuffer(resolve(directory, filename), output);
      onUnit?.();
      return filename;
    }),
  );
  const files = variants.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failed = variants.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    await Promise.all(
      files.map((filename) =>
        rm(resolve(directory, filename), { force: true }),
      ),
    );
    throw failed.reason;
  }
  files.sort(
    (left, right) =>
      Number(left.match(/-(\d+)\.avif$/)?.[1]) -
      Number(right.match(/-(\d+)\.avif$/)?.[1]),
  );
  const srcset = prepared.widths
    .map((width) => `/media/${publicFolder}/${base}-${width}.avif ${width}w`)
    .join(", ");
  return {
    files,
    markup: `<img src="/media/${publicFolder}/${base}-${largest}.avif" srcset="${srcset}" sizes="(max-width: 70ch) 100vw, 70ch" width="${prepared.width}" height="${prepared.height}" alt="${escapeAttribute(alt)}" title="${escapeAttribute(alt)}">`,
  };
}

export async function importPostImage(
  root: string,
  folder: string,
  input: ImageImportInput,
) {
  return writePreparedMedia(
    await imageDirectory(root, folder),
    folder,
    input,
    await prepareImage(input),
  );
}

function validateImageSet(
  layout: ImageLayout,
  count: number,
  caption?: ImageCaptionInput,
) {
  const expected = layout === "pair" ? 2 : 1;
  if (count !== expected)
    throw new Error(
      `${layout} layout requires exactly ${expected} image${expected === 1 ? "" : "s"}`,
    );
  if (layout === "single" && caption?.type === "individual")
    throw new Error("A single image cannot have individual pair captions");
  if (
    caption?.type === "individual" &&
    (!Array.isArray(caption.texts) || caption.texts.length !== 2)
  )
    throw new Error("Individual pair captions require two caption values");
}

function composeImageMarkup(
  layout: ImageLayout,
  images: string[],
  caption?: ImageCaptionInput,
) {
  validateImageSet(layout, images.length, caption);
  if (layout === "single") {
    return captioned(
      images[0],
      caption?.type === "shared" ? caption.text : undefined,
    );
  }
  const paired = images.map((image) =>
    image.replace(
      /sizes="[^"]*"/,
      'sizes="(max-width: 38rem) calc(100vw - 2rem), 35ch"',
    ),
  );
  if (caption?.type === "individual") {
    return `<div class="image-pair image-pair-individual">\n${paired
      .map((image, index) => captioned(image, caption.texts[index], true))
      .join("\n")}\n</div>`;
  }
  return captioned(
    `<div class="image-pair">\n${paired.join("\n")}\n</div>`,
    caption?.text,
  );
}

function mediaMarkup(asset: MediaAsset, alt: string) {
  const text = alt.trim();
  if (!text) throw new Error("Each image requires alt text");
  const responsive = asset.srcset
    ? ` srcset="${escapeAttribute(asset.srcset)}" sizes="(max-width: 70ch) 100vw, 70ch"`
    : "";
  const dimensions =
    asset.width && asset.height
      ? ` width="${asset.width}" height="${asset.height}"`
      : "";
  return `<img src="${escapeAttribute(asset.src)}"${responsive}${dimensions} alt="${escapeAttribute(text)}" title="${escapeAttribute(text)}">`;
}

export async function insertPostMedia(
  root: string,
  folder: string,
  input: ExistingPostImagesInput,
) {
  validateImageSet(input.layout, input.assets.length, input.caption);
  const keys = input.assets.map((asset) => `${asset.scope}:${asset.id}`);
  if (new Set(keys).size !== keys.length)
    throw new Error("Choose distinct media for an image pair");
  if (input.alts.length !== input.assets.length)
    throw new Error("Each image requires alt text");
  const [postMedia, sharedMedia] = await Promise.all([
    listPostMedia(root, folder),
    listSharedMedia(root),
  ]);
  const selected = input.assets.map(({ id, scope }) => {
    const library = scope === "shared" ? sharedMedia : postMedia;
    const asset = library.find((candidate) => candidate.id === id);
    if (!asset) throw new Error("Selected media no longer exists");
    return asset;
  });
  return {
    markup: composeImageMarkup(
      input.layout,
      selected.map((asset, index) => mediaMarkup(asset, input.alts[index])),
      input.caption,
    ),
  };
}

export async function deletePostMedia(
  root: string,
  folder: string,
  input: { assetId: string; references: string[] },
  operations: MediaFileOperations = mediaFileOperations,
) {
  const library = await listPostMedia(root, folder);
  const asset = library.find((candidate) => candidate.id === input.assetId);
  if (!asset) throw new Error("Selected media no longer exists");
  if (
    asset.files.some((file) =>
      input.references.some((reference) =>
        reference.includes(`/media/${folder}/${file}`),
      ),
    )
  )
    throw new Error(
      "Remove every saved reference to this media before deleting it",
    );
  const directory = await imageDirectory(root, folder);
  await deleteMediaGroup(directory, asset.files, operations);
  return {
    deleted: asset.files,
    media: await listPostMedia(root, folder),
  };
}

export async function importPostImages(
  root: string,
  folder: string,
  input: PostImagesImportInput,
  onProgress?: (progress: ImageConversionProgress) => void,
) {
  validateImageSet(input.layout, input.images.length, input.caption);
  for (const image of input.images) {
    imageAlt(image, "Each image requires alt text");
  }

  const prepared = await Promise.all(input.images.map(prepareImage));
  const directory = await imageDirectory(root, folder);
  const total = prepared.reduce(
    (sum, image) => sum + (image.kind === "svg" ? 1 : image.widths.length),
    0,
  );
  let completed = 0;
  onProgress?.({ completed, total });
  const unitComplete = () => {
    completed += 1;
    onProgress?.({ completed, total });
  };

  const imported: Awaited<ReturnType<typeof importPostImage>>[] = [];
  try {
    for (const [index, image] of input.images.entries()) {
      imported.push(
        await writePreparedMedia(
          directory,
          folder,
          image,
          prepared[index],
          unitComplete,
        ),
      );
    }
  } catch (error) {
    await Promise.all(
      imported
        .flatMap((result) => result.files)
        .map((filename) => rm(resolve(directory, filename), { force: true })),
    );
    throw error;
  }

  const files = imported.flatMap((result) => result.files);
  const primary = imported[0].files.at(-1)!;
  return {
    files,
    primary,
    markup: composeImageMarkup(
      input.layout,
      imported.map((result) => result.markup),
      input.caption,
    ),
  };
}

export async function importSharedImages(
  root: string,
  images: ImageImportInput[],
  onProgress?: (progress: ImageConversionProgress) => void,
) {
  if (!images.length || images.length > 10)
    throw new Error("Choose between one and ten images");
  const directory = await sharedImageDirectory(root, true);
  await mkdir(directory, { recursive: true });
  const prepared = await Promise.all(images.map(prepareImage));
  const total = prepared.reduce(
    (sum, image) => sum + (image.kind === "svg" ? 1 : image.widths.length),
    0,
  );
  let completed = 0;
  onProgress?.({ completed, total });
  const imported: Awaited<ReturnType<typeof importPostImage>>[] = [];
  try {
    for (const [index, image] of images.entries()) {
      imported.push(
        await writePreparedMedia(
          directory,
          "shared",
          { ...image, alt: image.alt || image.filename },
          prepared[index],
          () => onProgress?.({ completed: ++completed, total }),
        ),
      );
    }
  } catch (error) {
    await Promise.all(
      imported
        .flatMap((result) => result.files)
        .map((filename) => rm(resolve(directory, filename), { force: true })),
    );
    throw error;
  }
  return {
    files: imported.flatMap((result) => result.files),
    media: await listSharedMedia(root),
  };
}

export async function deleteSharedMedia(
  root: string,
  input: { assetId: string; references: string[] },
  operations: MediaFileOperations = mediaFileOperations,
) {
  const library = await listSharedMedia(root);
  const asset = library.find((candidate) => candidate.id === input.assetId);
  if (!asset) throw new Error("Selected media no longer exists");
  if (
    asset.files.some((file) =>
      input.references.some((reference) =>
        reference.includes(`/media/shared/${file}`),
      ),
    )
  )
    throw new Error("Remove every reference to this media before deleting it");
  const directory = await sharedImageDirectory(root);
  await deleteMediaGroup(directory, asset.files, operations);
  return {
    deleted: asset.files,
    media: await listSharedMedia(root),
  };
}

async function deleteMediaGroup(
  directory: string,
  files: string[],
  operations: MediaFileOperations,
) {
  const quarantine = resolve(directory, `.media-delete-${randomUUID()}`);
  await operations.mkdir(quarantine, { recursive: false });
  const moved: string[] = [];
  try {
    for (const file of files) {
      if (basename(file) !== file) throw new Error("Invalid media filename");
      await operations.rename(
        resolve(directory, file),
        resolve(quarantine, file),
      );
      moved.push(file);
    }
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (const file of moved.toReversed()) {
      try {
        await operations.rename(
          resolve(quarantine, file),
          resolve(directory, file),
        );
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (!rollbackFailures.length)
      await operations.rm(quarantine, { recursive: true, force: true });
    if (rollbackFailures.length)
      throw new AggregateError(
        [error, ...rollbackFailures],
        "Media deletion failed and rollback was incomplete",
      );
    throw error;
  }
  await operations.rm(quarantine, { recursive: true, force: false });
}
