import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { adjacentPosts, loadSite } from "../src/lib/content";
import { renderMarkdown } from "../src/lib/markdown";

const settings = `
title: Example Blog
description: A small, durable blog.
author: Example Author
domain: https://example.com
locale: en-US
navigation:
  - label: Home
    href: /
  - label: About
    href: /about/
  - label: RSS
    href: /rss.xml
socialLinks: []
defaultSocialImage: null
robots:
  index: true
  follow: true
  allowAiTraining: false
  advancedRules: ''
frames: []
`;

async function makeSite() {
  const root = await mkdtemp(join(tmpdir(), "blog-template-"));
  await mkdir(join(root, "content", "posts"), { recursive: true });
  await writeFile(join(root, "site.config.yaml"), settings);
  return root;
}

async function addPost(root: string, folder: string, source: string) {
  const directory = join(root, "content", "posts", folder);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "index.md"), source);
}

describe("content pipeline", () => {
  test("publishes ready posts newest first and keeps drafts private", async () => {
    const root = await makeSite();
    await addPost(
      root,
      "26-08-01--older-note",
      `---\ntitle: Older note\ndescription: First note\nslug: older-note\ndraft: false\npublished: 2026-08-01\ntags: [Notes]\naliases: []\nsocialImage: null\n---\nOlder body.\n`,
    );
    await addPost(
      root,
      "26-08-05--newer-note",
      `---\ntitle: Newer note\ndescription: Second note\nslug: newer-note\ndraft: false\npublished: 2026-08-05\ntags: [Notes]\naliases: []\nsocialImage: null\n---\nNewer body.\n`,
    );
    await addPost(
      root,
      "26-08-06--private-draft",
      `---\ntitle: Private draft\ndescription: Never publish this\nslug: private-draft\ndraft: true\ntags: []\naliases: []\nsocialImage: null\n---\nSecret draft body.\n`,
    );

    const site = await loadSite({ root });

    expect(site.settings.accentColor).toBe("#BC5215");
    expect(site.posts.map((post) => post.slug)).toEqual([
      "newer-note",
      "older-note",
    ]);
    expect(adjacentPosts(site.posts, "newer-note").previous?.slug).toBe(
      "older-note",
    );
    expect(adjacentPosts(site.posts, "newer-note").next).toBeUndefined();
    expect(adjacentPosts(site.posts, "older-note").previous).toBeUndefined();
    expect(adjacentPosts(site.posts, "older-note").next?.slug).toBe(
      "newer-note",
    );
    expect(JSON.stringify(site)).not.toContain("Private draft");
    expect(JSON.stringify(site)).not.toContain("Secret draft body");
  });

  test("rejects slug and alias collisions before building", async () => {
    const root = await makeSite();
    await addPost(
      root,
      "26-08-01--one",
      `---\ntitle: One\ndescription: One\nslug: one\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: [old-one]\nsocialImage: null\n---\nOne.\n`,
    );
    await addPost(
      root,
      "26-08-02--two",
      `---\ntitle: Two\ndescription: Two\nslug: old-one\ndraft: false\npublished: 2026-08-02\ntags: []\naliases: []\nsocialImage: null\n---\nTwo.\n`,
    );

    await expect(loadSite({ root })).rejects.toThrow(/collision.*old-one/i);
  });

  test("normalizes exact duplicate Tags to one Tag and one index row", async () => {
    const root = await makeSite();
    await addPost(
      root,
      "26-08-01--tagged",
      `---\ntitle: Tagged\ndescription: Tagged Post\nslug: tagged\ndraft: false\npublished: 2026-08-01\ntags: [Notes, Notes]\naliases: []\nsocialImage: null\n---\nBody.\n`,
    );

    const site = await loadSite({ root });

    expect(site.posts[0].tags).toEqual(["Notes"]);
    expect(site.tags.get("notes")?.posts.map((post) => post.slug)).toEqual([
      "tagged",
    ]);
  });

  test("rejects impossible dates and unconfigured protocol-relative frames", async () => {
    const dated = await makeSite();
    await addPost(
      dated,
      "26-08-01--bad-date",
      `---\ntitle: Bad date\ndescription: Invalid metadata\nslug: bad-date\ndraft: false\npublished: 2026-02-31\ntags: []\naliases: []\nsocialImage: null\n---\nBody.\n`,
    );
    await expect(loadSite({ root: dated })).rejects.toThrow(
      /real calendar date/i,
    );

    const framed = await makeSite();
    await addPost(
      framed,
      "26-08-01--bad-frame",
      `---\ntitle: Bad frame\ndescription: Invalid frame\nslug: bad-frame\ndraft: false\npublished: 2026-08-01\ntags: []\naliases: []\nsocialImage: null\n---\n<iframe src="//outside.example/embed" title="Outside"></iframe>\n`,
    );
    await expect(loadSite({ root: framed })).rejects.toThrow(/iframe/i);
  });

  test("rejects a Draft-owned site default Social Image", async () => {
    const root = await makeSite();
    const folder = "26-08-06--private-draft";
    await addPost(
      root,
      folder,
      `---\ntitle: Private draft\ndescription: Never publish this\nslug: private-draft\ndraft: true\ntags: []\naliases: []\nsocialImage: null\n---\nSecret draft body.\n`,
    );
    await writeFile(
      join(root, "content", "posts", folder, "private.svg"),
      "<svg />",
    );
    const settingsPath = join(root, "site.config.yaml");
    const configured = (await readFile(settingsPath, "utf8")).replace(
      "defaultSocialImage: null",
      `defaultSocialImage: /media/${folder}/private.svg`,
    );
    await writeFile(settingsPath, configured);

    await expect(loadSite({ root })).rejects.toThrow(
      /default Social Image.*non-Draft Post or shared media/i,
    );
  });

  test("rejects an existing non-image path as a Social Image", async () => {
    const root = await makeSite();
    await mkdir(join(root, "public"));
    await writeFile(join(root, "public", "theme.js"), "export {};");
    const settingsPath = join(root, "site.config.yaml");
    await writeFile(
      settingsPath,
      (await readFile(settingsPath, "utf8")).replace(
        "defaultSocialImage: null",
        "defaultSocialImage: /theme.js",
      ),
    );

    await expect(loadSite({ root })).rejects.toThrow(/image/i);
  });
});

describe("trusted Markdown rendering", () => {
  test("keeps SVG, iframes, and same-origin module enhancements", async () => {
    const html = await renderMarkdown(`
<svg viewBox="0 0 10 10" aria-label="A dot"><circle cx="5" cy="5" r="2" /></svg>

<iframe src="https://video.example/embed/1" title="A video"></iframe>

<script type="module" src="/effects/sparkle.js"></script>
`);

    expect(html).toContain("<svg");
    expect(html).toContain("<iframe");
    expect(html).toContain('type="module" src="/effects/sparkle.js"');
  });

  test("rejects executable inline markup instead of silently rewriting it", async () => {
    await expect(
      renderMarkdown(
        `<button onclick="steal()">Label</button><script>alert('no')</script>`,
      ),
    ).rejects.toThrow(/forbidden executable markup/i);
  });

  test("rejects executable markup inside iframe srcdoc", async () => {
    await expect(
      renderMarkdown(
        '<iframe title="Unsafe" srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
      ),
    ).rejects.toThrow(/srcdoc|script|executable/i);
  });

  test("rejects module URLs that become cross-origin after backslash normalization", async () => {
    await expect(
      renderMarkdown(
        '<script type="module" src="/\\outside.example/effect.js"></script>',
      ),
    ).rejects.toThrow(/module|script|executable/i);
  });

  test("unknown fenced languages fall back to escaped plain code", async () => {
    const html = await renderMarkdown("```made-up-language\n<x> & y\n```");

    expect(html).not.toContain("<x>");
    expect(html).toMatch(/(?:&lt;|&#x3C;)x/);
    expect(html).toContain("<pre");
  });

  test("keeps Local CMS links clickable only during development", async () => {
    const source = "Use the [development-only authoring tool](/cms/).";

    expect(await renderMarkdown(source)).toContain(
      "<span>development-only authoring tool</span>",
    );
    expect(await renderMarkdown(source)).not.toContain('href="/cms/"');
    expect(await renderMarkdown(source, { localCmsLinks: true })).toContain(
      '<a href="/cms/">development-only authoring tool</a>',
    );
  });

  test("makes Post-relative links and responsive media absolute for feeds", async () => {
    const html = await renderMarkdown(
      `[About](/about/) [Next](next)

<img src="/media/post/photo-960.avif" srcset="/media/post/photo-480.avif 480w, /media/post/photo-960.avif 960w" alt="Photo">`,
      { baseUrl: "https://example.com/posts/example/" },
    );

    expect(html).toContain('href="https://example.com/about/"');
    expect(html).toContain('href="https://example.com/posts/example/next"');
    expect(html).toContain(
      'src="https://example.com/media/post/photo-960.avif"',
    );
    expect(html).toContain(
      'srcset="https://example.com/media/post/photo-480.avif 480w, https://example.com/media/post/photo-960.avif 960w"',
    );
  });
});
