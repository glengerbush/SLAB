import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import { auditBuildReport, draftFingerprints } from "../src/lib/audit.ts";
import { expectedDeploymentFiles } from "../src/lib/deployment-manifest.ts";
import { renderMarkdown } from "../src/lib/markdown.ts";

const root = process.cwd();
const postsRoot = resolve(root, "content", "posts");
const forbiddenText = [];
const forbiddenPaths = [];
const records = [];

for (const entry of await readdir(postsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = await readFile(
    resolve(postsRoot, entry.name, "index.md"),
    "utf8",
  );
  const post = matter(source);
  records.push({
    folder: entry.name,
    draft: post.data.draft === true,
    fingerprints: draftFingerprints(
      post.data,
      post.content,
      await renderMarkdown(post.content),
    ),
  });
}

const publishedFingerprints = new Set(
  records.filter((post) => !post.draft).flatMap((post) => post.fingerprints),
);
for (const post of records) {
  if (post.draft) {
    forbiddenText.push(
      ...post.fingerprints.filter((value) => !publishedFingerprints.has(value)),
    );
    forbiddenPaths.push(`media/${post.folder}/`);
  }
}

const dist = resolve(root, "dist");
const expectedFiles = await expectedDeploymentFiles(root, dist);
const { errors, warnings } = await auditBuildReport(dist, {
  forbiddenText,
  forbiddenPaths,
  expectedFiles,
  checkExternalLinks: true,
});
if (warnings.length) {
  console.warn(
    `Non-blocking external-link report:\n- ${warnings.join("\n- ")}`,
  );
}
if (errors.length) {
  console.error(`Production artifact audit failed:\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Production artifact audit passed.");
}
