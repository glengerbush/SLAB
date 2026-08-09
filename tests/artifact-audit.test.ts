import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import {
  auditBuild,
  auditBuildReport,
  checkExternalLink,
  draftFingerprints,
} from "../src/lib/audit";

const publicResolver = async (hostname: string) => {
  if (hostname.includes(":"))
    return [{ address: hostname, family: 6 as const }];
  if (/^\d+(?:\.\d+){3}$/.test(hostname))
    return [{ address: hostname, family: 4 as const }];
  return [{ address: "93.184.216.34", family: 4 as const }];
};

test("accepts a self-contained static artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await mkdir(join(root, "posts", "hello"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    '<a href="/posts/hello/">Hello</a>',
  );
  await writeFile(
    join(root, "posts", "hello", "index.html"),
    '<h1 id="hello">Hello</h1>',
  );

  await expect(auditBuild(root)).resolves.toEqual([]);
});

test("rejects private material, source maps, CMS output, and broken internal links", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await mkdir(join(root, "cms"), { recursive: true });
  await writeFile(
    join(root, "index.html"),
    '<a href="/missing/">Missing</a><a href="#absent">Bad anchor</a><p>Private draft</p>',
  );
  await writeFile(join(root, "cms", "index.html"), "cms");
  await writeFile(join(root, "app.js.map"), "{}");

  const errors = await auditBuild(root, { forbiddenText: ["Private draft"] });

  expect(errors.join("\n")).toMatch(/cms/i);
  expect(errors.join("\n")).toMatch(/source map/i);
  expect(errors.join("\n")).toMatch(/Private draft/i);
  expect(errors.join("\n")).toMatch(/missing/i);
  expect(errors.join("\n")).toMatch(/anchor/i);
});

test("rejects every artifact outside the deployment manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await writeFile(join(root, "index.html"), "<h1>Expected</h1>");
  await writeFile(join(root, ".env"), "PRIVATE_TOKEN=secret");
  await writeFile(join(root, "private.pem"), "private key");
  await writeFile(join(root, "renamed-draft.bin"), "draft bytes");
  await writeFile(join(root, "unknown-source.txt"), "source material");

  const errors = await auditBuild(root, { expectedFiles: ["index.html"] });

  expect(errors).toEqual(
    expect.arrayContaining([
      "Unexpected production artifact: .env",
      "Unexpected production artifact: private.pem",
      "Unexpected production artifact: renamed-draft.bin",
      "Unexpected production artifact: unknown-source.txt",
    ]),
  );
});

test("rejects a missing artifact declared by the deployment manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await writeFile(join(root, "index.html"), "<h1>Expected</h1>");

  const errors = await auditBuild(root, {
    expectedFiles: ["index.html", "theme.js"],
  });

  expect(errors).toContain(
    "Missing production artifact from manifest: theme.js",
  );
});

test("checks relative assets and reports external links without failing", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await mkdir(join(root, "posts", "hello"), { recursive: true });
  await writeFile(
    join(root, "posts", "hello", "index.html"),
    '<img src="photo.avif"><img alt=""><a href="../missing/">Missing</a><a href="https://outside.example/">Outside</a>',
  );

  const unavailable = (async () =>
    new Response("", { status: 503 })) as typeof fetch;
  const report = await auditBuildReport(root, {
    checkExternalLinks: true,
    fetcher: unavailable,
    resolver: publicResolver,
  });

  expect(report.errors.join("\n")).toMatch(/image without alt/i);
  expect(report.errors.join("\n")).toMatch(/image without source/i);
  expect(report.errors.join("\n")).toMatch(/photo\.avif/);
  expect(report.errors.join("\n")).toMatch(/\.\.\/missing/);
  expect(report.warnings).toEqual([
    expect.stringContaining("unreachable (503)"),
  ]);
});

test("checks accessible iframe and video metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await writeFile(
    join(root, "index.html"),
    '<iframe src="https://example.com"></iframe><video controls><source src="demo.mp4"></video>',
  );

  const report = await auditBuildReport(root);

  expect(report.errors).toContain(
    "Iframe without a descriptive title in index.html",
  );
  expect(report.warnings).toContain(
    "Video without a captions track in index.html; confirm it is silent or provide captions",
  );
});

test("accepts titled iframes and captioned video", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-dist-"));
  await writeFile(join(root, "demo.mp4"), "video");
  await writeFile(join(root, "captions.vtt"), "WEBVTT");
  await writeFile(
    join(root, "index.html"),
    '<iframe title="Project simulation" src="https://example.com"></iframe><video controls><source src="demo.mp4"><track kind="captions" src="captions.vtt" srclang="en" label="English"></video>',
  );

  await expect(auditBuildReport(root)).resolves.toEqual({
    errors: [],
    warnings: [],
  });
});

test("accepts a reachable external link", async () => {
  const reachable = (async () =>
    new Response(null, { status: 204 })) as typeof fetch;

  await expect(
    checkExternalLink(
      "https://outside.example/",
      reachable,
      4_000,
      publicResolver,
    ),
  ).resolves.toBeNull();
});

test("reports a permanently gone external link", async () => {
  const gone = (async () =>
    new Response(null, { status: 410 })) as typeof fetch;

  await expect(
    checkExternalLink(
      "https://outside.example/old",
      gone,
      4_000,
      publicResolver,
    ),
  ).resolves.toMatch(/unreachable \(410\)/);
});

test("never requests literal, resolved, or redirected private addresses", async () => {
  const reachable = (async () =>
    new Response(null, { status: 204 })) as typeof fetch;
  await expect(
    checkExternalLink("http://[fc00::1]/", reachable, 4_000, publicResolver),
  ).resolves.toMatch(/private address/i);
  await expect(
    checkExternalLink(
      "https://private.example/",
      reachable,
      4_000,
      async () => [{ address: "127.0.0.1", family: 4 as const }],
    ),
  ).resolves.toMatch(/private address/i);

  const redirecting = (async () =>
    new Response(null, {
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/" },
    })) as typeof fetch;
  await expect(
    checkExternalLink(
      "https://outside.example/",
      redirecting,
      4_000,
      publicResolver,
    ),
  ).resolves.toMatch(/private address/i);
});

test("fingerprints rendered draft content and reader-facing metadata", () => {
  const values = draftFingerprints(
    {
      title: "Private title",
      description: "Private description",
      slug: "private-slug",
      tags: ["Private tag"],
      aliases: ["old-private-slug"],
    },
    "A **secret** body.",
    "<p>A <strong>secret</strong> body.</p>",
  );

  expect(values).toContain("Private description");
  expect(values).toContain("<p>A <strong>secret</strong> body.</p>");
  expect(values).toContain(
    "&lt;p&gt;A &lt;strong&gt;secret&lt;/strong&gt; body.&lt;/p&gt;",
  );
  expect(values).toContain("A secret body.");
  expect(values).toContain("/tags/private-tag/");
  expect(values).toContain("/posts/old-private-slug/");
});
