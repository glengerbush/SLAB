import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import YAML from "yaml";

import type { PostDocument, PostStatus } from "../lib/cms-contracts";
import { assertPostFolderName, fileLabel } from "../lib/post-policy";
import { postDataSchema, slugSchema, type PostData } from "../lib/schema";
import { resolveRealDirectory } from "./filesystem";
import { listPostMedia } from "./images";

const run = promisify(execFile);
const mutationTails = new Map<string, Promise<void>>();
export type { PostDocument, PostStatus } from "../lib/cms-contracts";

export interface CreatePostInput {
  title: string;
  description: string;
  slug: string;
  draft?: boolean;
  published?: string;
  updated?: string;
  tags?: string[];
  aliases?: string[];
  socialImage?: string | null;
  body?: string;
}

export interface SaveOptions {
  expectedRevision: string;
  now?: Date;
  confirmSlugChange?: boolean;
  commentsEnabled?: boolean;
  allowCommentKeyChange?: boolean;
}

async function withPostMutation<T>(root: string, mutation: () => Promise<T>) {
  const key = resolve(root);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  const operation = previous.then(mutation);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(key, tail);
  try {
    return await operation;
  } finally {
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}

function dateOnly(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function revision(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

function realPostsRoot(root: string) {
  return resolveRealDirectory(root, ["content", "posts"]);
}

async function postPath(root: string, folder: string) {
  assertPostFolderName(folder);
  if (basename(folder) !== folder) throw new Error("Invalid post folder");
  const posts = await realPostsRoot(root);
  const directory = await resolveRealDirectory(posts, [folder]);
  const file = resolve(directory, "index.md");
  const local = relative(posts, file);
  if (isAbsolute(local) || local.startsWith(".."))
    throw new Error("Post path escaped its root");
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Post folder must be a real directory");
  const sourceInfo = await lstat(file);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink())
    throw new Error("Post source must be a real file");
  return file;
}

function parseSource(source: string) {
  return matter(source, {
    engines: { yaml: (value) => YAML.parse(value) as object },
    language: "yaml",
  });
}

function serialize(data: PostData, body: string, existingFrontmatter = "") {
  const document = YAML.parseDocument(existingFrontmatter);
  if (document.errors.length) throw document.errors[0];
  document.set("title", data.title);
  document.set("description", data.description);
  document.set("slug", data.slug);
  document.set("draft", data.draft);
  if (data.published) document.set("published", data.published);
  else document.delete("published");
  if (data.updated) document.set("updated", data.updated);
  else document.delete("updated");
  document.set("tags", data.tags);
  document.set("aliases", data.aliases);
  document.set("socialImage", data.socialImage);
  if (data.commentKey) document.set("commentKey", data.commentKey);
  else document.delete("commentKey");
  const frontmatter = document.toString().trimEnd();
  return `---\n${frontmatter}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
}

async function statusFor(
  root: string,
  sourcePath: string,
  data: PostData,
): Promise<PostStatus> {
  if (data.draft) return "Draft";
  const path = relative(root, sourcePath).split("\\").join("/");
  try {
    await run("git", ["cat-file", "-e", `HEAD:${path}`], { cwd: root });
  } catch {
    return "Ready";
  }
  try {
    const result = await run("git", ["status", "--porcelain", "--", path], {
      cwd: root,
    });
    return result.stdout.trim() ? "Unreleased" : "Published";
  } catch {
    return "Published";
  }
}

export async function readPost(
  root: string,
  folder: string,
): Promise<PostDocument> {
  const sourcePath = await postPath(root, folder);
  const source = await readFile(sourcePath, "utf8");
  const parsed = parseSource(source);
  const data = postDataSchema.parse(parsed.data);
  const media = await listPostMedia(root, folder);
  const images = media.flatMap((asset) => asset.files).sort();
  return {
    ...data,
    folder,
    body: parsed.content,
    images,
    media,
    revision: revision(source),
    status: await statusFor(root, sourcePath, data),
  };
}

export async function readPostRevision(root: string, folder: string) {
  const sourcePath = await postPath(root, folder);
  return revision(await readFile(sourcePath, "utf8"));
}

export async function listPostDocuments(root: string) {
  const entries = await readdir(await realPostsRoot(root), {
    withFileTypes: true,
  });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readPost(root, entry.name)),
  );
}

async function assertClaimsAvailable(
  root: string,
  candidate: PostData,
  exceptFolder?: string,
) {
  const posts = await listPostDocuments(root);
  const claims = new Set([candidate.slug, ...candidate.aliases]);
  for (const post of posts) {
    if (post.folder === exceptFolder) continue;
    for (const claim of [post.slug, ...post.aliases]) {
      if (claims.has(claim))
        throw new Error(`Slug or alias collision for "${claim}"`);
    }
  }
}

async function atomicWrite(path: string, source: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function createPostUnlocked(
  root: string,
  input: CreatePostInput,
  now = new Date(),
  commentsEnabled = false,
) {
  const posts = await realPostsRoot(root);
  const data = postDataSchema.parse({
    title: input.title,
    description: input.description.trim() || input.title,
    slug: slugSchema.parse(input.slug),
    draft: input.draft ?? true,
    published:
      input.published || (input.draft === false ? dateOnly(now) : undefined),
    updated: input.updated,
    tags: input.tags ?? [],
    aliases: input.aliases ?? [],
    socialImage: input.socialImage ?? null,
    commentKey:
      input.draft === false && commentsEnabled
        ? `${input.title.trim()} [${randomUUID().replaceAll("-", "").slice(0, 12)}]`
        : undefined,
  });
  await assertClaimsAvailable(root, data);
  const prefix = dateOnly(now).slice(2);
  const base = `${prefix}--${fileLabel(input.title, "post")}`;
  let folder = base;
  let suffix = 2;
  while (
    await access(resolve(posts, folder)).then(
      () => true,
      () => false,
    )
  ) {
    folder = `${base}-${suffix++}`;
  }
  await mkdir(resolve(posts, folder));
  await atomicWrite(
    resolve(posts, folder, "index.md"),
    serialize(data, input.body ?? ""),
  );
  return readPost(root, folder);
}

export function createPost(
  root: string,
  input: CreatePostInput,
  now = new Date(),
  commentsEnabled = false,
) {
  return withPostMutation(root, () =>
    createPostUnlocked(root, input, now, commentsEnabled),
  );
}

async function deletePostUnlocked(
  root: string,
  folder: string,
  expectedRevision: string,
) {
  const current = await readPost(root, folder);
  if (current.revision !== expectedRevision) {
    throw new Error(
      "This post changed outside the CMS; reload it before deleting",
    );
  }
  const sourcePath = await postPath(root, folder);
  const source = await readFile(sourcePath, "utf8");
  if (revision(source) !== expectedRevision) {
    throw new Error(
      "This post changed outside the CMS; reload it before deleting",
    );
  }
  await rm(dirname(sourcePath), { recursive: true });
  return { deleted: folder };
}

export function deletePost(
  root: string,
  folder: string,
  expectedRevision: string,
) {
  return withPostMutation(root, () =>
    deletePostUnlocked(root, folder, expectedRevision),
  );
}

function readerVisibleChanged(
  current: PostDocument,
  next: PostData,
  body: string,
) {
  return (
    current.title !== next.title ||
    current.description !== next.description ||
    current.slug !== next.slug ||
    current.published !== next.published ||
    current.socialImage !== next.socialImage ||
    JSON.stringify(current.tags) !== JSON.stringify(next.tags) ||
    current.body !== body
  );
}

async function savePostUnlocked(
  root: string,
  folder: string,
  input: PostDocument,
  options: SaveOptions,
) {
  const current = await readPost(root, folder);
  if (current.revision !== options.expectedRevision) {
    throw new Error(
      "This post changed outside the CMS; reload or compare before saving",
    );
  }
  const aliases = [...input.aliases];
  if (
    (current.status === "Published" || current.status === "Unreleased") &&
    current.slug !== input.slug
  ) {
    if (!options.confirmSlugChange) {
      throw new Error("Confirm the published slug change before saving");
    }
    if (!aliases.includes(current.slug)) aliases.push(current.slug);
  }
  const raw: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    slug: input.slug,
    draft: input.draft,
    published: input.published,
    updated: input.updated,
    tags: input.tags,
    aliases,
    socialImage: input.socialImage,
    commentKey: options.allowCommentKeyChange
      ? input.commentKey
      : current.commentKey,
  };
  if (current.draft && !input.draft && !raw.published) {
    raw.published = dateOnly(options.now);
  }
  let next = postDataSchema.parse(raw);
  if (!next.draft && options.commentsEnabled && !next.commentKey) {
    next = postDataSchema.parse({
      ...next,
      commentKey: `${next.title} [${randomUUID().replaceAll("-", "").slice(0, 12)}]`,
    });
  }
  if (current.published && readerVisibleChanged(current, next, input.body)) {
    next = postDataSchema.parse({ ...next, updated: dateOnly(options.now) });
  }
  await assertClaimsAvailable(root, next, folder);
  const sourcePath = await postPath(root, folder);
  const currentSource = await readFile(sourcePath, "utf8");
  if (revision(currentSource) !== options.expectedRevision) {
    throw new Error(
      "This post changed outside the CMS; reload or compare before saving",
    );
  }
  await atomicWrite(
    sourcePath,
    serialize(next, input.body, parseSource(currentSource).matter),
  );
  return readPost(root, folder);
}

export function savePost(
  root: string,
  folder: string,
  input: PostDocument,
  options: SaveOptions,
) {
  return withPostMutation(root, () =>
    savePostUnlocked(root, folder, input, options),
  );
}
