import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { expect, test } from "vitest";

import {
  readSiteSettingsDocument,
  removeCommentsSetup,
  saveSiteSettings,
} from "../src/cms/settings";
import {
  chooseGiscusCategory,
  discoverGiscusRepository,
  giscusLanguage,
  parseGiscusScript,
  resolveGiscusDiscussion,
} from "../src/cms/comments";
import { loadSite } from "../src/lib/content";
import { postDataSchema, siteSettingsSchema } from "../src/lib/schema";
import { createPost, savePost } from "../src/cms/repository";

const settings = {
  title: "Example Blog",
  description: "Description",
  author: "Author",
  domain: "https://example.com",
  locale: "en-US",
  navigation: [],
  socialLinks: [],
  defaultSocialImage: null,
  robots: {
    index: true,
    follow: true,
    allowAiTraining: false,
    advancedRules: "",
  },
  frames: [],
};

test("keeps Comments absent for Blogs that never configure them", () => {
  expect(siteSettingsSchema.parse(settings).comments).toBeUndefined();
});

test("accepts a complete disabled giscus Comment Configuration", () => {
  const parsed = siteSettingsSchema.parse({
    ...settings,
    comments: {
      provider: "giscus",
      enabled: false,
      repository: "author/conversations",
      repositoryId: "R_kgDOExample",
      category: "Announcements",
      categoryId: "DIC_kwDOExample",
      requireConsent: true,
      lazy: true,
      reactions: true,
      inputPosition: "bottom",
    },
  });

  expect(parsed.comments).toMatchObject({
    repository: "author/conversations",
    enabled: false,
    inputPosition: "bottom",
  });
});

test("rejects malformed GitHub node IDs", () => {
  expect(() =>
    siteSettingsSchema.parse({
      ...settings,
      comments: {
        provider: "giscus",
        enabled: false,
        repository: "author/conversations",
        repositoryId: "R_<x>",
        category: "Announcements",
        categoryId: "DIC_<x>",
        requireConsent: true,
        lazy: true,
        reactions: true,
        inputPosition: "bottom",
      },
    }),
  ).toThrow();
});

test("accepts an immutable Comment Key in Post frontmatter", () => {
  const post = postDataSchema.parse({
    title: "A durable title",
    description: "Description",
    slug: "durable-title",
    draft: false,
    published: "2026-08-09",
    tags: [],
    aliases: [],
    socialImage: null,
    commentKey: "A durable title [a1b2c3d4e5f6]",
  });

  expect(post.commentKey).toBe("A durable title [a1b2c3d4e5f6]");
});

test("enabling Comments assigns stable keys only to non-Draft Posts", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-comments-"));
  await mkdir(join(root, "content", "posts", "26-08-01--published"), {
    recursive: true,
  });
  await mkdir(join(root, "content", "posts", "26-08-02--draft"), {
    recursive: true,
  });
  const settingsSource = YAML.stringify(settings);
  await writeFile(join(root, "site.config.yaml"), settingsSource);
  await writeFile(
    join(root, "content", "posts", "26-08-01--published", "index.md"),
    `---\ntitle: Published Post\ndescription: Description\nslug: published\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: []\nsocialImage: null\n---\nBody.\n`,
  );
  await writeFile(
    join(root, "content", "posts", "26-08-02--draft", "index.md"),
    `---\ntitle: Draft Post\ndescription: Description\nslug: draft\ndraft: true\ntags: []\naliases: []\nsocialImage: null\n---\nDraft.\n`,
  );
  const configured = siteSettingsSchema.parse({
    ...settings,
    comments: {
      provider: "giscus",
      enabled: true,
      repository: "author/conversations",
      repositoryId: "R_kgDOExample",
      category: "Announcements",
      categoryId: "DIC_kwDOExample",
      requireConsent: true,
      lazy: true,
      reactions: true,
      inputPosition: "bottom",
    },
  });

  await saveSiteSettings(
    root,
    configured,
    createHash("sha256").update(settingsSource).digest("hex"),
  );

  const published = await readFile(
    join(root, "content", "posts", "26-08-01--published", "index.md"),
    "utf8",
  );
  const draft = await readFile(
    join(root, "content", "posts", "26-08-02--draft", "index.md"),
    "utf8",
  );
  expect(published).toMatch(/commentKey: Published Post \[[a-f0-9]{12}\]/);
  expect(draft).not.toContain("commentKey:");
});

test("new published Posts receive a key while Drafts do not", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-comments-create-"));
  await mkdir(join(root, "content", "posts"), { recursive: true });
  const base = {
    title: "New Post",
    description: "Description",
    slug: "new-post",
    published: "2026-08-09",
    tags: [],
    aliases: [],
    socialImage: null,
    body: "Body.",
  };

  const published = await createPost(
    root,
    { ...base, draft: false },
    new Date("2026-08-09T12:00:00Z"),
    true,
  );
  const draft = await createPost(
    root,
    {
      ...base,
      title: "Draft Post",
      slug: "draft-post",
      draft: true,
      published: undefined,
    },
    new Date("2026-08-10T12:00:00Z"),
    true,
  );

  expect(published.commentKey).toMatch(/^New Post \[[a-f0-9]{12}\]$/);
  expect(draft.commentKey).toBeUndefined();

  const ordinarySave = await savePost(
    root,
    published.folder,
    { ...published, commentKey: "Replacement Key [ffffffffffff]" },
    { expectedRevision: published.revision, commentsEnabled: true },
  );
  expect(ordinarySave.commentKey).toBe(published.commentKey);
});

test("rejects an enabled build when a published Post has no Comment Key", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-comments-build-"));
  await mkdir(join(root, "content", "posts", "26-08-01--published"), {
    recursive: true,
  });
  await writeFile(
    join(root, "site.config.yaml"),
    YAML.stringify({
      ...settings,
      comments: {
        provider: "giscus",
        enabled: true,
        repository: "author/conversations",
        repositoryId: "R_kgDOExample",
        category: "Announcements",
        categoryId: "DIC_kwDOExample",
        requireConsent: true,
        lazy: true,
        reactions: true,
        inputPosition: "bottom",
      },
    }),
  );
  await writeFile(
    join(root, "content", "posts", "26-08-01--published", "index.md"),
    `---\ntitle: Published Post\ndescription: Description\nslug: published\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: []\nsocialImage: null\n---\nBody.\n`,
  );

  await expect(loadSite({ root })).rejects.toThrow(/Comment Key.*published/i);
});

test("discovers Announcements without asking when categories are ambiguous", () => {
  expect(
    chooseGiscusCategory([
      { id: "DIC_general", name: "General" },
      { id: "DIC_announcements", name: "Announcements" },
    ]),
  ).toEqual({ id: "DIC_announcements", name: "Announcements" });
  expect(
    chooseGiscusCategory([
      { id: "DIC_general", name: "General" },
      { id: "DIC_ideas", name: "Ideas" },
    ]),
  ).toBeNull();
});

test("parses only safe fields from a giscus.app fallback script", () => {
  const parsed = parseGiscusScript(`<script src="https://giscus.app/client.js"
    data-repo="author/conversations"
    data-repo-id="R_kgDOExample"
    data-category="Announcements"
    data-category-id="DIC_kwDOExample"
    data-mapping="pathname"
    data-strict="0"
    data-reactions-enabled="1"
    data-emit-metadata="0"
    data-input-position="top"
    data-theme="preferred_color_scheme"
    data-lang="en"
    data-loading="lazy"
    crossorigin="anonymous"
    async></script>`);

  expect(parsed).toEqual({
    provider: "giscus",
    enabled: false,
    repository: "author/conversations",
    repositoryId: "R_kgDOExample",
    category: "Announcements",
    categoryId: "DIC_kwDOExample",
    requireConsent: true,
    lazy: true,
    reactions: true,
    inputPosition: "top",
  });
  expect(() =>
    parseGiscusScript(
      '<script src="https://evil.example/client.js" data-repo="a/b"></script>',
    ),
  ).toThrow(/official giscus/i);
});

test("maps Site locale to a supported giscus language", () => {
  expect(giscusLanguage("pt-BR")).toBe("pt");
  expect(giscusLanguage("zh-Hant-HK")).toBe("zh-HK");
  expect(giscusLanguage("xx-Unknown")).toBe("en");
});

test("discovers repository and category IDs through giscus", async () => {
  const result = await discoverGiscusRepository(
    "author/conversations",
    async () =>
      new Response(
        JSON.stringify({
          repositoryId: "R_kgDOExample",
          categories: [
            { id: "DIC_general", name: "General" },
            { id: "DIC_announcements", name: "Announcements" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );

  expect(result.selectedCategory?.name).toBe("Announcements");
  expect(result.repositoryId).toBe("R_kgDOExample");
});

test("resolves the exact strict Comment Key Discussion", async () => {
  const url = await resolveGiscusDiscussion(
    "author/conversations",
    "Announcements",
    "A durable title [a1b2c3d4e5f6]",
    async (input) => {
      expect(String(input)).toContain("strict=true");
      expect(String(input)).toContain("term=A+durable+title");
      return new Response(
        JSON.stringify({
          discussion: {
            url: "https://github.com/author/conversations/discussions/42",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );

  expect(url).toBe("https://github.com/author/conversations/discussions/42");
});

test("full Comments Removal deletes configuration and every key", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-comments-remove-"));
  await mkdir(join(root, "content", "posts", "26-08-01--published"), {
    recursive: true,
  });
  await writeFile(join(root, "site.config.yaml"), YAML.stringify(settings));
  await writeFile(
    join(root, "content", "posts", "26-08-01--published", "index.md"),
    `---\ntitle: Published Post\ndescription: Description\nslug: published\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: []\nsocialImage: null\ncommentKey: Published Post [a1b2c3d4e5f6]\n---\nBody.\n`,
  );
  const opened = await readSiteSettingsDocument(root);
  const saved = await saveSiteSettings(
    root,
    siteSettingsSchema.parse({
      ...opened.settings,
      comments: {
        provider: "giscus",
        enabled: true,
        repository: "author/conversations",
        repositoryId: "R_kgDOExample",
        category: "Announcements",
        categoryId: "DIC_kwDOExample",
        requireConsent: true,
        lazy: true,
        reactions: true,
        inputPosition: "bottom",
      },
    }),
    opened.revision,
  );

  await removeCommentsSetup(root, saved.revision, "REMOVE COMMENTS");

  expect(
    (await readSiteSettingsDocument(root)).settings.comments,
  ).toBeUndefined();
  expect(
    await readFile(
      join(root, "content", "posts", "26-08-01--published", "index.md"),
      "utf8",
    ),
  ).not.toContain("commentKey:");
});

test("disabling Comments preserves configuration and keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-comments-disable-"));
  await mkdir(join(root, "content", "posts", "26-08-01--published"), {
    recursive: true,
  });
  await writeFile(join(root, "site.config.yaml"), YAML.stringify(settings));
  await writeFile(
    join(root, "content", "posts", "26-08-01--published", "index.md"),
    `---\ntitle: Published Post\ndescription: Description\nslug: published\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: []\nsocialImage: null\ncommentKey: Published Post [a1b2c3d4e5f6]\n---\nBody.\n`,
  );
  const opened = await readSiteSettingsDocument(root);
  const enabled = await saveSiteSettings(
    root,
    siteSettingsSchema.parse({
      ...opened.settings,
      comments: {
        provider: "giscus",
        enabled: true,
        repository: "author/conversations",
        repositoryId: "R_kgDOExample",
        category: "Announcements",
        categoryId: "DIC_kwDOExample",
        requireConsent: true,
        lazy: true,
        reactions: true,
        inputPosition: "bottom",
      },
    }),
    opened.revision,
  );
  const disabled = await saveSiteSettings(
    root,
    siteSettingsSchema.parse({
      ...enabled.settings,
      comments: { ...enabled.settings.comments!, enabled: false },
    }),
    enabled.revision,
  );

  expect(disabled.settings.comments?.enabled).toBe(false);
  expect(
    await readFile(
      join(root, "content", "posts", "26-08-01--published", "index.md"),
      "utf8",
    ),
  ).toContain("commentKey: Published Post [a1b2c3d4e5f6]");
});
