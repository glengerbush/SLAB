import { lstat } from "node:fs/promises";
import { basename, resolve } from "node:path";

export async function resolveRealDirectory(
  root: string,
  segments: string[],
  options: { allowMissingLeaf?: boolean } = {},
) {
  let directory = resolve(root);
  const chain = [directory];
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      basename(segment) !== segment
    )
      throw new Error("Invalid repository directory");
    directory = resolve(directory, segment);
    chain.push(directory);
  }

  for (const [index, path] of chain.entries()) {
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (
        error.code === "ENOENT" &&
        options.allowMissingLeaf &&
        index === chain.length - 1
      )
        return null;
      throw error;
    });
    if (!info) return path;
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Repository path must be a real directory");
  }
  return directory;
}
