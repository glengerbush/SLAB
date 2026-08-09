import { copyFile, mkdtemp, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

import { deletePersistedPost } from "../src/cms/post-deletion";
import { createPost, savePost } from "../src/cms/repository";

test("protects Post media referenced by another Post before deletion", async () => {
  const root = await mkdtemp(join(tmpdir(), "blog-post-deletion-"));
  await mkdir(join(root, "content", "posts"), { recursive: true });
  await copyFile(resolve("site.config.yaml"), join(root, "site.config.yaml"));
  const owner = await createPost(root, {
    title: "Owner",
    description: "Owns media",
    slug: "owner",
  });
  const other = await createPost(root, {
    title: "Other",
    description: "References media",
    slug: "other",
  });
  const referencing = await savePost(
    root,
    other.folder,
    {
      ...other,
      body: `<img src="/media/${owner.folder}/shared.svg" alt="Shared">`,
    },
    { expectedRevision: other.revision },
  );

  await expect(
    deletePersistedPost(root, owner.folder, owner.revision),
  ).rejects.toThrow(/every saved reference/i);

  await savePost(
    root,
    other.folder,
    { ...referencing, body: "Reference removed." },
    { expectedRevision: referencing.revision },
  );
  await deletePersistedPost(root, owner.folder, owner.revision);
  expect(await readdir(join(root, "content", "posts"))).toEqual([other.folder]);
});
