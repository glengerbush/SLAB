import { access, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

import { renderMarkdown } from "./markdown";
import { assertPostFolderName } from "./post-policy";
import {
  postDataSchema,
  siteSettingsSchema,
  type PostData,
  type SiteSettings,
} from "./schema";

export interface Post extends PostData {
  body: string;
  html: string;
  folder: string;
  sourcePath: string;
}

export interface SiteData {
  settings: SiteSettings;
  posts: Post[];
  tags: Map<string, { name: string; posts: Post[] }>;
}

export interface LoadSiteOptions {
  root?: string;
}

export interface AdjacentPosts {
  previous?: Post;
  next?: Post;
}

export function adjacentPosts(posts: Post[], slug: string): AdjacentPosts {
  const index = posts.findIndex((post) => post.slug === slug);
  if (index === -1) return {};
  return {
    previous: posts[index + 1],
    next: posts[index - 1],
  };
}

function parseFrontmatter(source: string) {
  return matter(source, {
    engines: { yaml: (value) => YAML.parse(value) as object },
    language: "yaml",
  });
}

async function readSettings(root: string) {
  const source = await readFile(resolve(root, "site.config.yaml"), "utf8");
  return siteSettingsSchema.parse(YAML.parse(source));
}

export async function loadAllPosts(root = process.cwd()) {
  const postsRoot = resolve(root, "content", "posts");
  const entries = await readdir(postsRoot, { withFileTypes: true });
  const posts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        assertPostFolderName(entry.name);
        const sourcePath = resolve(postsRoot, entry.name, "index.md");
        const source = await readFile(sourcePath, "utf8");
        const parsed = parseFrontmatter(source);
        const data = postDataSchema.parse(parsed.data);
        return {
          ...data,
          body: parsed.content,
          folder: entry.name,
          sourcePath,
        };
      }),
  );

  const claimed = new Map<string, string>();
  for (const post of posts) {
    for (const slug of [post.slug, ...post.aliases]) {
      const owner = claimed.get(slug);
      if (owner) {
        throw new Error(
          `Slug or alias collision for "${slug}" (${owner}, ${post.slug})`,
        );
      }
      claimed.set(slug, post.slug);
    }
  }

  return posts;
}

export async function loadSite(
  options: LoadSiteOptions = {},
): Promise<SiteData> {
  const root = options.root ?? process.cwd();
  const [settings, allPosts] = await Promise.all([
    readSettings(root),
    loadAllPosts(root),
  ]);
  const published = allPosts
    .filter((post) => !post.draft)
    .sort((a, b) => b.published!.localeCompare(a.published!));
  const posts = await Promise.all(
    published.map(async (post) => ({
      ...post,
      html: await renderMarkdown(post.body),
    })),
  );
  await validatePublishedContent(root, settings, posts);
  const tags = new Map<string, { name: string; posts: Post[] }>();
  for (const post of posts) {
    for (const tag of post.tags) {
      const slug = tagSlug(tag);
      const existing = tags.get(slug);
      if (existing && existing.name !== tag) {
        throw new Error(
          `Tag URL collision for "${existing.name}" and "${tag}"`,
        );
      }
      const tagged = existing ?? { name: tag, posts: [] };
      tagged.posts.push(post);
      tags.set(slug, tagged);
    }
  }
  return { settings, posts, tags };
}

async function validatePublishedContent(
  root: string,
  settings: SiteSettings,
  posts: Post[],
) {
  const frameOrigins = new Set(
    settings.frames.map((value) => new URL(value).origin),
  );
  for (const post of posts) {
    for (const match of post.html.matchAll(
      /<iframe\b[^>]*\bsrc=["']([^"']+)["']/gi,
    )) {
      const value = match[1];
      if (value.startsWith("/") && !value.startsWith("//")) continue;
      let origin: string;
      try {
        origin = new URL(value).origin;
      } catch {
        throw new Error(`Invalid iframe URL in ${post.slug}: ${value}`);
      }
      if (!frameOrigins.has(origin))
        throw new Error(
          `Iframe origin is not allowed in Site Settings: ${origin}`,
        );
    }
    if (post.socialImage)
      await assertPublicAsset(root, post.socialImage, post.slug);
  }
  if (settings.defaultSocialImage) {
    const postMedia = settings.defaultSocialImage.match(/^\/media\/([^/]+)\//);
    if (
      postMedia &&
      postMedia[1] !== "shared" &&
      !posts.some((post) => post.folder === postMedia[1])
    ) {
      throw new Error(
        `Site Settings default Social Image must belong to a non-Draft Post or shared media: ${settings.defaultSocialImage}`,
      );
    }
    await assertPublicAsset(root, settings.defaultSocialImage, "Site Settings");
  }
}

async function assertPublicAsset(root: string, path: string, owner: string) {
  const media = path.match(/^\/media\/([^/]+)\/(.+)$/);
  const file = media
    ? media[1] === "shared"
      ? resolve(root, "content", "media", media[2])
      : resolve(root, "content", "posts", media[1], media[2])
    : resolve(root, "public", path.replace(/^\//, ""));
  const local = relative(resolve(root), file);
  if (isAbsolute(local) || local.startsWith(".."))
    throw new Error(`Invalid social image path for ${owner}`);
  await access(file).catch(() => {
    throw new Error(`Missing social image for ${owner}: ${path}`);
  });
}

export function tagSlug(tag: string) {
  const slug = tag
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error(`Tag "${tag}" cannot form a URL`);
  return slug;
}
