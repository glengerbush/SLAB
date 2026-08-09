import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import matter from "gray-matter";
import { describe, expect, test } from "vitest";

import {
  createPost,
  deletePost,
  readPost,
  savePost,
} from "../src/cms/repository";

const run = promisify(execFile);

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "blog-cms-"));
  await mkdir(join(root, "content", "posts"), { recursive: true });
  return root;
}

describe("local CMS repository", () => {
  test("creates a dated folder independent from the explicit slug", async () => {
    const root = await makeRoot();
    const post = await createPost(
      root,
      {
        title: "A Human Label",
        description: "Description",
        slug: "permanent-url",
      },
      new Date("2026-08-06T12:00:00Z"),
    );

    expect(post.folder).toBe("26-08-06--a-human-label");
    expect(post.slug).toBe("permanent-url");
    expect(
      await readFile(
        join(root, "content", "posts", post.folder, "index.md"),
        "utf8",
      ),
    ).toContain("slug: permanent-url");
  });

  test("creates a complete Post directly from the full editor", async () => {
    const root = await makeRoot();
    const post = await createPost(
      root,
      {
        title: "Full editor",
        description: "",
        slug: "full-editor",
        draft: false,
        tags: ["CMS"],
        aliases: ["old-full-editor"],
        socialImage: "/media/social.avif",
        body: "Written before the first save.",
      },
      new Date("2026-08-06T12:00:00Z"),
    );

    expect(post).toMatchObject({
      title: "Full editor",
      description: "Full editor",
      slug: "full-editor",
      draft: false,
      published: "2026-08-06",
      tags: ["CMS"],
      aliases: ["old-full-editor"],
      socialImage: "/media/social.avif",
      body: "\nWritten before the first save.",
    });
  });

  test("deletes a Post folder only at the expected revision", async () => {
    const root = await makeRoot();
    const post = await createPost(root, {
      title: "Temporary",
      description: "Temporary Post",
      slug: "temporary",
    });

    await expect(
      deletePost(root, post.folder, "stale-revision"),
    ).rejects.toThrow(/changed outside/i);
    expect(await readdir(join(root, "content", "posts"))).toEqual([
      post.folder,
    ]);

    await expect(deletePost(root, post.folder, post.revision)).resolves.toEqual(
      { deleted: post.folder },
    );
    expect(await readdir(join(root, "content", "posts"))).toEqual([]);
  });

  test("uses the author's local calendar date across the UTC rollover", async () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const root = await makeRoot();
      const now = new Date("2026-08-08T03:30:00Z");
      const created = await createPost(
        root,
        { title: "Evening Post", description: "Description", slug: "evening" },
        now,
      );
      expect(created.folder).toMatch(/^26-08-07--/);

      const published = await savePost(
        root,
        created.folder,
        { ...created, draft: false },
        { expectedRevision: created.revision, now },
      );
      expect(published.published).toBe("2026-08-07");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  test("sets publication and honest update dates and preserves old slugs", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const ready = await savePost(
      root,
      created.folder,
      { ...created, draft: false, body: "Published body." },
      {
        expectedRevision: created.revision,
        now: new Date("2026-08-02T12:00:00Z"),
      },
    );
    expect(ready.published).toBe("2026-08-02");
    expect(ready.updated).toBeUndefined();
    await run("git", ["init"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "Publish",
      ],
      { cwd: root },
    );
    const published = await readPost(root, ready.folder);

    await expect(
      savePost(
        root,
        ready.folder,
        { ...published, slug: "better-first", body: "Revised body." },
        {
          expectedRevision: published.revision,
          now: new Date("2026-08-04T12:00:00Z"),
        },
      ),
    ).rejects.toThrow(/confirm/i);

    const revised = await savePost(
      root,
      ready.folder,
      { ...published, slug: "better-first", body: "Revised body." },
      {
        expectedRevision: published.revision,
        now: new Date("2026-08-04T12:00:00Z"),
        confirmSlugChange: true,
      },
    );
    expect(revised.aliases).toContain("first");
    expect(revised.updated).toBe("2026-08-04");
  });

  test("sets Updated on Save when a Publish-selected Post has no Git commit", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const ready = await savePost(
      root,
      created.folder,
      { ...created, draft: false, body: "Published body." },
      {
        expectedRevision: created.revision,
        now: new Date("2026-08-02T12:00:00Z"),
      },
    );

    const edited = await savePost(
      root,
      ready.folder,
      { ...ready, body: "Edited while Publish remains selected." },
      {
        expectedRevision: ready.revision,
        now: new Date("2026-08-03T12:00:00Z"),
      },
    );

    expect(edited.status).toBe("Ready");
    expect(edited.updated).toBe("2026-08-03");

    const redated = await savePost(
      root,
      edited.folder,
      { ...edited, published: "2026-08-01" },
      {
        expectedRevision: edited.revision,
        now: new Date("2026-08-04T12:00:00Z"),
      },
    );
    expect(redated.updated).toBe("2026-08-04");
  });

  test("dates edits saved while a previously published Post is Draft", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const published = await savePost(
      root,
      created.folder,
      { ...created, draft: false, body: "Published body." },
      {
        expectedRevision: created.revision,
        now: new Date("2026-08-02T12:00:00Z"),
      },
    );
    const draft = await savePost(
      root,
      published.folder,
      { ...published, draft: true },
      {
        expectedRevision: published.revision,
        now: new Date("2026-08-03T12:00:00Z"),
      },
    );
    expect(draft.updated).toBeUndefined();

    const editedDraft = await savePost(
      root,
      draft.folder,
      { ...draft, body: "Edited while Draft." },
      {
        expectedRevision: draft.revision,
        now: new Date("2026-08-04T12:00:00Z"),
      },
    );
    expect(editedDraft.updated).toBe("2026-08-04");

    const republished = await savePost(
      root,
      editedDraft.folder,
      { ...editedDraft, draft: false },
      {
        expectedRevision: editedDraft.revision,
        now: new Date("2026-08-05T12:00:00Z"),
      },
    );
    expect(republished.updated).toBe("2026-08-04");
  });

  test("refuses to overwrite a manually changed file", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const path = join(root, "content", "posts", created.folder, "index.md");
    await writeFile(path, `${await readFile(path, "utf8")}\nManual edit.\n`);

    await expect(
      savePost(
        root,
        created.folder,
        { ...created, body: "CMS edit." },
        { expectedRevision: created.revision },
      ),
    ).rejects.toThrow(/changed outside/i);

    expect((await readPost(root, created.folder)).body).toContain(
      "Manual edit.",
    );
  });

  test.each([
    ["an Alias matching the current Slug", ["first"]],
    ["duplicate Aliases", ["old-first", "old-first"]],
  ])("rejects %s on Save", async (_label, aliases) => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );

    await expect(
      savePost(
        root,
        created.folder,
        { ...created, aliases },
        { expectedRevision: created.revision },
      ),
    ).rejects.toThrow(/alias|duplicate|slug/i);
  });

  test("allows only one of two concurrent saves with the same revision", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );

    const results = await Promise.allSettled([
      savePost(
        root,
        created.folder,
        { ...created, body: "First concurrent edit." },
        { expectedRevision: created.revision },
      ),
      savePost(
        root,
        created.folder,
        { ...created, body: "Second concurrent edit." },
        { expectedRevision: created.revision },
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  test("allows only one concurrent Post to claim the same Slug", async () => {
    const root = await makeRoot();
    const [first, second] = await Promise.all([
      createPost(
        root,
        { title: "First", description: "First", slug: "first" },
        new Date("2026-08-01T12:00:00Z"),
      ),
      createPost(
        root,
        { title: "Second", description: "Second", slug: "second" },
        new Date("2026-08-02T12:00:00Z"),
      ),
    ]);

    const results = await Promise.allSettled([
      savePost(
        root,
        first.folder,
        { ...first, slug: "shared-claim" },
        { expectedRevision: first.revision },
      ),
      savePost(
        root,
        second.folder,
        { ...second, slug: "shared-claim" },
        { expectedRevision: second.revision },
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  test("preserves manually added frontmatter when the CMS saves", async () => {
    const root = await makeRoot();
    const created = await createPost(
      root,
      { title: "First", description: "Description", slug: "first" },
      new Date("2026-08-01T12:00:00Z"),
    );
    const path = join(root, "content", "posts", created.folder, "index.md");
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source.replace(
        "draft: true",
        "draft: true\ncustom:\n  layout: wide\n  accent: plum # keep this",
      ),
    );
    const manuallyExtended = await readPost(root, created.folder);

    await savePost(
      root,
      created.folder,
      { ...manuallyExtended, title: "Edited in CMS" },
      { expectedRevision: manuallyExtended.revision },
    );

    const saved = await readFile(path, "utf8");
    expect(matter(saved).data.custom).toEqual({
      layout: "wide",
      accent: "plum",
    });
    expect(saved).toContain("# keep this");
  });

  test.skipIf(process.platform === "win32")(
    "rejects a symlinked content ancestor before creating outside the repository",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "blog-cms-"));
      const outside = await mkdtemp(join(tmpdir(), "blog-cms-outside-"));
      await mkdir(join(outside, "posts"));
      await symlink(outside, join(root, "content"));

      await expect(
        createPost(
          root,
          { title: "Escaped", description: "Description", slug: "escaped" },
          new Date("2026-08-01T12:00:00Z"),
        ),
      ).rejects.toThrow(/real directory/i);
      expect(await readdir(join(outside, "posts"))).toEqual([]);
    },
  );

  test.skipIf(process.platform === "win32")(
    "rejects a post source symlink",
    async () => {
      const root = await makeRoot();
      const created = await createPost(
        root,
        { title: "First", description: "Description", slug: "first" },
        new Date("2026-08-01T12:00:00Z"),
      );
      const path = join(root, "content", "posts", created.folder, "index.md");
      const outside = join(root, "outside.md");
      await writeFile(outside, await readFile(path, "utf8"));
      await unlink(path);
      await symlink(outside, path);

      await expect(readPost(root, created.folder)).rejects.toThrow(
        /real file/i,
      );
    },
  );
});
