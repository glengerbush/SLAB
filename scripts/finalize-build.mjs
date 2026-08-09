import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import matter from "gray-matter";
import YAML from "yaml";

const root = process.cwd();
const dist = resolve(root, "dist");
const postsRoot = resolve(root, "content", "posts");
const sharedMediaRoot = resolve(root, "content", "media");
const settings = YAML.parse(
  await readFile(resolve(root, "site.config.yaml"), "utf8"),
);
const redirects = [];

for (const entry of await readdir(postsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = resolve(postsRoot, entry.name);
  const post = matter(await readFile(resolve(directory, "index.md"), "utf8"));
  if (post.data.draft === true) continue;
  for (const alias of post.data.aliases ?? []) {
    redirects.push(`/posts/${alias}/ /posts/${post.data.slug}/ 301`);
  }
  for (const asset of await readdir(directory, { withFileTypes: true })) {
    if (!asset.isFile() || !/\.(?:avif|svg)$/i.test(asset.name)) continue;
    const mediaDirectory = resolve(dist, "media", entry.name);
    await mkdir(mediaDirectory, { recursive: true });
    await cp(
      resolve(directory, asset.name),
      resolve(mediaDirectory, asset.name),
    );
  }
}

async function generatedFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await generatedFiles(path)));
    else if (entry.isFile() && /\.(?:html|xml|txt)$/i.test(entry.name))
      files.push(path);
  }
  return files;
}

const sharedReferences = new Set();
let commentsClientReferenced = false;
for (const file of await generatedFiles(dist)) {
  const source = await readFile(file, "utf8");
  if (source.includes('src="/comments.js"')) commentsClientReferenced = true;
  for (const match of source.matchAll(
    /\/media\/shared\/([a-z0-9][a-z0-9.-]*\.(?:avif|svg))/gi,
  ))
    sharedReferences.add(match[1]);
}
for (const filename of sharedReferences) {
  const source = resolve(sharedMediaRoot, filename);
  const mediaDirectory = resolve(dist, "media", "shared");
  await mkdir(mediaDirectory, { recursive: true });
  await cp(source, resolve(mediaDirectory, filename));
}

const frameOrigins = (settings.frames ?? []).map(
  (value) => new URL(value).origin,
);
const frameSource = frameOrigins.length
  ? ` 'self' ${frameOrigins.join(" ")}`
  : " 'self'";
const commentsEnabled =
  settings.comments?.enabled === true && commentsClientReferenced;
if (!commentsEnabled) await rm(resolve(dist, "comments.js"), { force: true });
const scriptSource = commentsEnabled ? " 'self' https://giscus.app" : " 'self'";
const commentsFrameSource = commentsEnabled ? " https://giscus.app" : "";
const commentsStyleSource = commentsEnabled ? " https://giscus.app" : "";
const csp = `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'${commentsStyleSource}; script-src${scriptSource}; frame-src${frameSource}${commentsFrameSource}; connect-src 'self'`;
await writeFile(resolve(dist, "_redirects"), `${redirects.join("\n")}\n`);
await writeFile(
  resolve(dist, "_headers"),
  `/*\n  Content-Security-Policy: ${csp}\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n`,
);
