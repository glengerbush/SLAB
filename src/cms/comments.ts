import { randomBytes } from "node:crypto";

import { commentConfigurationSchema, type SiteSettings } from "../lib/schema";
export { giscusLanguage } from "../lib/giscus";
import { listPostDocuments, savePost } from "./repository";

export interface GiscusCategory {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
}

export function chooseGiscusCategory(categories: GiscusCategory[]) {
  const announcements = categories.filter(
    (category) => category.name.toLowerCase() === "announcements",
  );
  if (announcements.length === 1) return announcements[0];
  return categories.length === 1 ? categories[0] : null;
}

export async function discoverGiscusRepository(
  repository: string,
  fetcher: typeof fetch = fetch,
) {
  const normalized = commentConfigurationSchema
    .pick({ repository: true })
    .parse({ repository }).repository;
  const response = await fetcher(
    `https://giscus.app/api/discussions/categories?repo=${encodeURIComponent(normalized)}`,
    { headers: { Accept: "application/json" } },
  );
  const value = (await response.json()) as {
    repositoryId?: unknown;
    categories?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Unable to connect to giscus",
    );
  }
  if (
    typeof value.repositoryId !== "string" ||
    !/^R_[A-Za-z0-9_-]{4,98}$/.test(value.repositoryId) ||
    !Array.isArray(value.categories)
  ) {
    throw new Error("giscus returned an invalid repository response");
  }
  const categories: GiscusCategory[] = value.categories.map((category) => {
    if (
      !category ||
      typeof category !== "object" ||
      typeof (category as GiscusCategory).id !== "string" ||
      !/^DIC_[A-Za-z0-9_-]{4,96}$/.test((category as GiscusCategory).id) ||
      typeof (category as GiscusCategory).name !== "string"
    ) {
      throw new Error("giscus returned an invalid category");
    }
    const typed = category as GiscusCategory;
    return {
      id: typed.id,
      name: typed.name,
      ...(typeof typed.emoji === "string" ? { emoji: typed.emoji } : {}),
      ...(typeof typed.description === "string"
        ? { description: typed.description }
        : {}),
    };
  });
  if (!categories.length) throw new Error("Enable GitHub Discussions first");
  return {
    repository: normalized,
    repositoryId: value.repositoryId,
    categories,
    selectedCategory: chooseGiscusCategory(categories),
  };
}

export async function resolveGiscusDiscussion(
  repository: string,
  category: string,
  commentKey: string,
  fetcher: typeof fetch = fetch,
) {
  const query = new URLSearchParams({
    repo: repository,
    category,
    term: commentKey,
    strict: "true",
    first: "1",
  });
  const response = await fetcher(
    `https://giscus.app/api/discussions?${query.toString()}`,
    { headers: { Accept: "application/json" } },
  );
  if (response.status === 404) return null;
  const value = (await response.json()) as {
    discussion?: { url?: unknown };
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "Unable to find the GitHub Discussion",
    );
  }
  const url = value.discussion?.url;
  if (
    typeof url !== "string" ||
    !url.startsWith(`https://github.com/${repository}/discussions/`)
  ) {
    throw new Error("giscus returned an invalid Discussion URL");
  }
  return url;
}

export function parseGiscusScript(source: string) {
  if (source.length > 20_000) throw new Error("giscus script is too large");
  const script = source.match(/^\s*<script\b([\s\S]*?)>\s*<\/script>\s*$/i);
  if (!script) throw new Error("Paste one complete giscus script");
  const attributes = new Map<string, string>();
  const pattern = /([A-Za-z_:][A-Za-z0-9:._-]*)(?:\s*=\s*(["'])(.*?)\2)?/gs;
  let match: RegExpExecArray | null;
  let consumed = "";
  while ((match = pattern.exec(script[1]))) {
    consumed += match[0];
    const name = match[1].toLowerCase();
    if (attributes.has(name)) throw new Error(`Duplicate ${name} attribute`);
    attributes.set(name, match[3] ?? "");
  }
  if (!consumed || script[1].replace(pattern, "").trim()) {
    throw new Error("giscus script contains invalid attributes");
  }
  const allowed = new Set([
    "src",
    "data-repo",
    "data-repo-id",
    "data-category",
    "data-category-id",
    "data-mapping",
    "data-strict",
    "data-reactions-enabled",
    "data-emit-metadata",
    "data-input-position",
    "data-theme",
    "data-lang",
    "data-loading",
    "crossorigin",
    "async",
  ]);
  for (const name of attributes.keys()) {
    if (!allowed.has(name)) throw new Error(`Unsupported ${name} attribute`);
  }
  if (attributes.get("src") !== "https://giscus.app/client.js") {
    throw new Error("Use the official giscus client script");
  }
  return commentConfigurationSchema.parse({
    provider: "giscus",
    enabled: false,
    repository: attributes.get("data-repo"),
    repositoryId: attributes.get("data-repo-id"),
    category: attributes.get("data-category"),
    categoryId: attributes.get("data-category-id"),
    requireConsent: true,
    lazy: attributes.get("data-loading") === "lazy",
    reactions: attributes.get("data-reactions-enabled") !== "0",
    inputPosition:
      attributes.get("data-input-position") === "top" ? "top" : "bottom",
  });
}

export function commentsRepositoryUrl(
  comments: NonNullable<SiteSettings["comments"]>,
) {
  return `https://github.com/${comments.repository}`;
}

export function generateCommentKey(title: string) {
  const suffix = randomBytes(6).toString("hex");
  return `${title.trim()} [${suffix}]`;
}

export async function ensureCommentKeys(root: string) {
  const posts = await listPostDocuments(root);
  let changed = 0;
  for (const post of posts) {
    if (post.draft || post.commentKey) continue;
    await savePost(
      root,
      post.folder,
      { ...post, commentKey: generateCommentKey(post.title) },
      {
        expectedRevision: post.revision,
        commentsEnabled: true,
        allowCommentKeyChange: true,
      },
    );
    changed += 1;
  }
  return changed;
}

export async function removeCommentKeys(root: string) {
  const posts = await listPostDocuments(root);
  let changed = 0;
  for (const post of posts) {
    if (!post.commentKey) continue;
    await savePost(
      root,
      post.folder,
      { ...post, commentKey: undefined },
      {
        expectedRevision: post.revision,
        commentsEnabled: false,
        allowCommentKeyChange: true,
      },
    );
    changed += 1;
  }
  return changed;
}

export async function countMissingCommentKeys(root: string) {
  const posts = await listPostDocuments(root);
  return posts.filter((post) => !post.draft && !post.commentKey).length;
}
