import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";

export default async function teardown() {
  const record = resolve(".astro", "acceptance-root.txt");
  const target = await readFile(record, "utf8").then(
    (value) => value.trim(),
    () => "",
  );

  if (
    target &&
    dirname(target) === tmpdir() &&
    basename(target).startsWith("blog-acceptance-")
  ) {
    await rm(target, { recursive: true, force: true });
  }
  await rm(record, { force: true });
}
