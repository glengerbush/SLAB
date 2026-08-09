import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

import { readSiteSettings, saveSiteSettings } from "../src/cms/settings";

const source = `
title: Original title
description: Description
author: Author
domain: https://example.com
locale: en-US
navigation: []
socialLinks: []
defaultSocialImage: null
robots:
  index: true
  follow: true
  allowAiTraining: false
  advancedRules: ''
frames: []
`;

test("refuses to overwrite Site Settings changed after the form opened", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-settings-"));
  const path = join(root, "site.config.yaml");
  await writeFile(path, source);
  const opened = await readSiteSettings(root);
  const expectedRevision = createHash("sha256").update(source).digest("hex");
  await writeFile(path, source.replace("Original title", "File title"));

  await expect(
    saveSiteSettings(root, { ...opened, title: "CMS title" }, expectedRevision),
  ).rejects.toThrow(/changed outside|changed since/i);
  expect(await readFile(path, "utf8")).toContain("File title");
});
