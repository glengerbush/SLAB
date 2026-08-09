import { readFile, readdir } from "node:fs/promises";
import { extname, posix, resolve } from "node:path";
import matter from "gray-matter";

interface DeploymentManifest {
  version: 1;
  files: string[];
}

interface PublishedPostOutput {
  folder: string;
  slug: string;
  tags: string[];
}

function manifestPath(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Deployment manifest files must be non-empty strings");
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    posix.normalize(value) !== value ||
    value === "."
  ) {
    throw new Error(`Invalid deployment manifest path: ${value}`);
  }
  return value;
}

async function readManifest(root: string): Promise<DeploymentManifest> {
  const source = await readFile(
    resolve(root, "deployment.manifest.json"),
    "utf8",
  );
  const value = JSON.parse(source) as Record<string, unknown>;
  const unknownKeys = Object.keys(value).filter(
    (key) => key !== "version" && key !== "files",
  );
  if (unknownKeys.length) {
    throw new Error(
      `Unknown deployment manifest field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
    );
  }
  if (value.version !== 1) {
    throw new Error("deployment.manifest.json must use version 1");
  }
  if (!Array.isArray(value.files)) {
    throw new Error("deployment.manifest.json files must be an array");
  }
  const files = value.files.map(manifestPath);
  if (new Set(files).size !== files.length) {
    throw new Error("deployment.manifest.json contains duplicate files");
  }
  return { version: 1, files };
}

function tagSlug(tag: string) {
  const slug = tag
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Tag "${tag}" cannot form a deployment path`);
  return slug;
}

async function publishedPosts(root: string): Promise<PublishedPostOutput[]> {
  const postsRoot = resolve(root, "content", "posts");
  const entries = await readdir(postsRoot, { withFileTypes: true });
  const posts: PublishedPostOutput[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const source = await readFile(
      resolve(postsRoot, entry.name, "index.md"),
      "utf8",
    );
    const data = matter(source).data as Record<string, unknown>;
    if (data.draft === true) continue;
    if (typeof data.slug !== "string") {
      throw new Error(`Published Post ${entry.name} has no Slug`);
    }
    const tags = Array.isArray(data.tags)
      ? data.tags.filter((tag): tag is string => typeof tag === "string")
      : [];
    posts.push({ folder: entry.name, slug: data.slug, tags });
  }
  return posts;
}

function linkedGeneratedFiles(source: string, from: string) {
  const files = new Set<string>();
  for (const match of source.matchAll(
    /\/(?:_astro\/[a-z0-9._~/-]+|media\/shared\/[a-z0-9][a-z0-9.-]*\.(?:avif|svg))/gi,
  )) {
    files.add(match[0].slice(1).split(/[?#]/, 1)[0]);
  }
  if (!from.startsWith("_astro/")) return files;
  for (const match of source.matchAll(/["'](\.{1,2}\/[^"']+)["']/g)) {
    const path = posix.normalize(posix.join(posix.dirname(from), match[1]));
    if (path.startsWith("_astro/")) files.add(path.split(/[?#]/, 1)[0]);
  }
  for (const match of source.matchAll(
    /\burl\(\s*(?:["'])?(\.{1,2}\/[^)'"\s]+)(?:["'])?\s*\)/g,
  )) {
    const path = posix.normalize(posix.join(posix.dirname(from), match[1]));
    if (path.startsWith("_astro/")) files.add(path.split(/[?#]/, 1)[0]);
  }
  return files;
}

export async function expectedDeploymentFiles(
  root: string,
  artifactRoot: string,
) {
  const [manifest, posts] = await Promise.all([
    readManifest(root),
    publishedPosts(root),
  ]);
  const files = new Set(manifest.files);
  const tags = new Set<string>();

  for (const post of posts) {
    files.add(`posts/${post.slug}/index.html`);
    for (const tag of post.tags) tags.add(tagSlug(tag));
    const entries = await readdir(
      resolve(root, "content", "posts", post.folder),
      {
        withFileTypes: true,
      },
    );
    for (const entry of entries) {
      if (entry.isFile() && /\.(?:avif|svg)$/i.test(entry.name)) {
        files.add(`media/${post.folder}/${entry.name}`);
      }
    }
  }
  for (const tag of tags) files.add(`tags/${tag}/index.html`);

  const queue = [...files];
  const inspected = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (inspected.has(file)) continue;
    inspected.add(file);
    if (!/\.(?:html|xml|txt|js|css)$/i.test(extname(file))) continue;
    const source = await readFile(resolve(artifactRoot, file), "utf8").catch(
      () => null,
    );
    if (source === null) continue;
    for (const linked of linkedGeneratedFiles(source, file)) {
      if (files.has(linked)) continue;
      files.add(linked);
      queue.push(linked);
    }
  }

  return [...files].sort();
}
