import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { AstroIntegration } from "astro";
import { ZodError } from "zod";

import {
  deleteSharedMedia,
  importSharedImages,
  importPostImages,
  insertPostMedia,
  listPostMedia,
  listSharedMedia,
  type ExistingPostImagesInput,
  type ImageImportInput,
  type PostImagesImportInput,
} from "./images";
import { deletePersistedPostMedia } from "./media-deletion";
import { deletePersistedPost } from "./post-deletion";
import {
  countMissingCommentKeys,
  discoverGiscusRepository,
  parseGiscusScript,
  resolveGiscusDiscussion,
} from "./comments";
import {
  createPost,
  listPostDocuments,
  readPost,
  readPostRevision,
  savePost,
  type CreatePostInput,
  type PostDocument,
} from "./repository";
import {
  readSiteSettings,
  readSiteSettingsDocument,
  removeCommentsSetup,
  saveSiteSettings,
} from "./settings";
import { robotsText } from "../lib/presentation";

const run = promisify(execFile);
const apiPrefix = "/api/local-cms";

function json(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function errorMessage(error: unknown) {
  if (error instanceof ZodError)
    return "Some values are invalid. Review the form and try again.";
  return error instanceof Error ? error.message : "Unexpected Local CMS error";
}

async function body(request: IncomingMessage, limit = 26_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error("Request payload is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sameOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const host = request.headers.host;
  return origin === `http://${host}` || origin === `https://${host}`;
}

async function changedFiles(root: string) {
  try {
    const result = await run("git", ["status", "--short"], { cwd: root });
    return result.stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function cmsHtml(token: string) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<script src="/theme.js"></script><meta name="local-cms-token" content="${token}"><title>Site Editor</title></head>
<body><div id="cms"></div><script type="module" src="/src/cms/main.ts"></script></body></html>`;
}

function mimeType(filename: string) {
  if (filename.endsWith(".avif")) return "image/avif";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function localCms(): AstroIntegration {
  const token = randomBytes(32).toString("base64url");
  const root = process.cwd();
  return {
    name: "local-cms",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command === "dev") updateConfig({ server: { host: "127.0.0.1" } });
      },
      "astro:server:setup": ({ server }) => {
        server.middlewares.use(async (request, response, next) => {
          const requestUrl = new URL(
            request.url ?? "/",
            `http://${request.headers.host ?? "127.0.0.1"}`,
          );
          try {
            if (
              requestUrl.pathname === "/cms" ||
              requestUrl.pathname === "/cms/"
            ) {
              const html = await server.transformIndexHtml(
                "/cms/",
                cmsHtml(token),
              );
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.setHeader("Cache-Control", "no-store");
              response.end(html);
              return;
            }

            const media = requestUrl.pathname.match(
              /^\/media\/(shared|\d{2}-\d{2}-\d{2}--[a-z0-9][a-z0-9-]*)\/([^/]+)$/,
            );
            if (request.method === "GET" && media) {
              const filename = media[2];
              if (
                basename(filename) !== filename ||
                !/\.(?:avif|svg)$/i.test(filename)
              )
                throw new Error("Invalid media path");
              const path = resolve(
                root,
                "content",
                ...(media[1] === "shared" ? ["media"] : ["posts", media[1]]),
                filename,
              );
              const info = await lstat(path);
              if (!info.isFile() || info.isSymbolicLink())
                throw new Error("Invalid media file");
              response.statusCode = 200;
              response.setHeader("Content-Type", mimeType(filename));
              response.setHeader("Cache-Control", "no-store");
              response.end(await readFile(path));
              return;
            }

            if (!requestUrl.pathname.startsWith(apiPrefix)) return next();
            if (!sameOrigin(request))
              return json(response, 403, {
                error: "Cross-origin request rejected",
              });
            if (
              request.method !== "GET" &&
              request.headers["x-local-cms-token"] !== token
            ) {
              return json(response, 403, { error: "Invalid authoring token" });
            }

            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/bootstrap`
            ) {
              const [posts, media, settingsDocument, changed] =
                await Promise.all([
                  listPostDocuments(root),
                  listSharedMedia(root),
                  readSiteSettingsDocument(root),
                  changedFiles(root),
                ]);
              return json(response, 200, {
                posts,
                media,
                settings: settingsDocument.settings,
                settingsRevision: settingsDocument.revision,
                changed,
              });
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/sync`
            ) {
              const folder = requestUrl.searchParams.get("folder");
              const [changed, revision] = await Promise.all([
                changedFiles(root),
                folder ? readPostRevision(root, folder) : null,
              ]);
              return json(response, 200, { changed, revision });
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/changed`
            ) {
              return json(response, 200, { changed: await changedFiles(root) });
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/library`
            ) {
              return json(response, 200, await listSharedMedia(root));
            }
            const postRoute = requestUrl.pathname.match(
              new RegExp(`^${apiPrefix}/posts/([^/]+)$`),
            );
            if (request.method === "GET" && postRoute) {
              return json(
                response,
                200,
                await readPost(root, decodeURIComponent(postRoute[1])),
              );
            }
            if (
              request.method === "POST" &&
              requestUrl.pathname === `${apiPrefix}/posts`
            ) {
              const settings = await readSiteSettings(root);
              return json(
                response,
                201,
                await createPost(
                  root,
                  (await body(request, 100_000)) as CreatePostInput,
                  new Date(),
                  settings.comments?.enabled === true,
                ),
              );
            }
            if (request.method === "PUT" && postRoute) {
              const input = (await body(request, 2_500_000)) as {
                post: PostDocument;
                expectedRevision: string;
                confirmSlugChange?: boolean;
              };
              const saved = await savePost(
                root,
                decodeURIComponent(postRoute[1]),
                input.post,
                {
                  expectedRevision: input.expectedRevision,
                  confirmSlugChange: input.confirmSlugChange,
                  commentsEnabled:
                    (await readSiteSettings(root)).comments?.enabled === true,
                },
              );
              return json(response, 200, saved);
            }
            if (request.method === "DELETE" && postRoute) {
              const input = (await body(request, 10_000)) as {
                expectedRevision: string;
              };
              return json(
                response,
                200,
                await deletePersistedPost(
                  root,
                  decodeURIComponent(postRoute[1]),
                  input.expectedRevision,
                ),
              );
            }
            const mediaRoute = requestUrl.pathname.match(
              new RegExp(`^${apiPrefix}/media/([^/]+)$`),
            );
            if (request.method === "GET" && mediaRoute) {
              return json(
                response,
                200,
                await listPostMedia(root, decodeURIComponent(mediaRoute[1])),
              );
            }
            const mediaInsertRoute = requestUrl.pathname.match(
              new RegExp(`^${apiPrefix}/media/([^/]+)/insert$`),
            );
            if (request.method === "POST" && mediaInsertRoute) {
              return json(
                response,
                200,
                await insertPostMedia(
                  root,
                  decodeURIComponent(mediaInsertRoute[1]),
                  (await body(request, 100_000)) as ExistingPostImagesInput,
                ),
              );
            }
            const mediaDeleteRoute = requestUrl.pathname.match(
              new RegExp(`^${apiPrefix}/media/([^/]+)/([^/]+)$`),
            );
            if (request.method === "DELETE" && mediaDeleteRoute) {
              return json(
                response,
                200,
                await deletePersistedPostMedia(
                  root,
                  decodeURIComponent(mediaDeleteRoute[1]),
                  decodeURIComponent(mediaDeleteRoute[2]),
                ),
              );
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/settings`
            ) {
              const document = await readSiteSettingsDocument(root);
              return json(response, 200, {
                settings: document.settings,
                settingsRevision: document.revision,
              });
            }
            if (
              request.method === "PUT" &&
              requestUrl.pathname === `${apiPrefix}/settings`
            ) {
              const input = (await body(request, 500_000)) as {
                settings: Parameters<typeof saveSiteSettings>[1];
                expectedRevision: string;
              };
              const document = await saveSiteSettings(
                root,
                input.settings,
                input.expectedRevision,
              );
              return json(response, 200, {
                settings: document.settings,
                settingsRevision: document.revision,
                robots: robotsText(document.settings),
              });
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/comments/discover`
            ) {
              return json(
                response,
                200,
                await discoverGiscusRepository(
                  requestUrl.searchParams.get("repository") ?? "",
                ),
              );
            }
            if (
              request.method === "POST" &&
              requestUrl.pathname === `${apiPrefix}/comments/parse`
            ) {
              const input = (await body(request, 30_000)) as {
                script: string;
              };
              return json(response, 200, parseGiscusScript(input.script));
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/comments/missing`
            ) {
              return json(response, 200, {
                count: await countMissingCommentKeys(root),
              });
            }
            if (
              request.method === "DELETE" &&
              requestUrl.pathname === `${apiPrefix}/comments/setup`
            ) {
              const input = (await body(request, 10_000)) as {
                expectedRevision: string;
                confirmation: string;
              };
              const removed = await removeCommentsSetup(
                root,
                input.expectedRevision,
                input.confirmation,
              );
              return json(response, 200, {
                settings: removed.settings,
                settingsRevision: removed.revision,
                removedKeys: removed.removedKeys,
              });
            }
            if (
              request.method === "GET" &&
              requestUrl.pathname === `${apiPrefix}/comments/discussion`
            ) {
              const folder = requestUrl.searchParams.get("folder") ?? "";
              const [settings, post] = await Promise.all([
                readSiteSettings(root),
                readPost(root, folder),
              ]);
              if (!settings.comments || !post.commentKey) {
                throw new Error("This Post has no Comment Discussion");
              }
              return json(response, 200, {
                url: await resolveGiscusDiscussion(
                  settings.comments.repository,
                  settings.comments.category,
                  post.commentKey,
                ),
              });
            }
            const libraryDeleteRoute = requestUrl.pathname.match(
              new RegExp(`^${apiPrefix}/library/([^/]+)$`),
            );
            if (request.method === "DELETE" && libraryDeleteRoute) {
              const [posts, settings] = await Promise.all([
                listPostDocuments(root),
                readSiteSettings(root),
              ]);
              return json(
                response,
                200,
                await deleteSharedMedia(root, {
                  assetId: decodeURIComponent(libraryDeleteRoute[1]),
                  references: [
                    settings.defaultSocialImage ?? "",
                    ...posts.flatMap((post) => [
                      post.body,
                      post.socialImage ?? "",
                    ]),
                  ],
                }),
              );
            }
            if (
              request.method === "POST" &&
              requestUrl.pathname === `${apiPrefix}/library/images`
            ) {
              const input = (await body(request)) as {
                images: ImageImportInput[];
              };
              response.statusCode = 200;
              response.setHeader(
                "Content-Type",
                "application/x-ndjson; charset=utf-8",
              );
              response.setHeader("Cache-Control", "no-store");
              const send = (value: unknown) =>
                response.write(`${JSON.stringify(value)}\n`);
              try {
                const result = await importSharedImages(
                  root,
                  input.images,
                  ({ completed, total }) =>
                    send({
                      type: "progress",
                      percent: Math.round((completed / total) * 100),
                    }),
                );
                send({ type: "result", ...result });
              } catch (error) {
                send({ type: "error", error: errorMessage(error) });
              }
              response.end();
              return;
            }
            if (
              request.method === "POST" &&
              requestUrl.pathname === `${apiPrefix}/images`
            ) {
              const input = (await body(request)) as PostImagesImportInput & {
                folder: string;
              };
              response.statusCode = 200;
              response.setHeader(
                "Content-Type",
                "application/x-ndjson; charset=utf-8",
              );
              response.setHeader("Cache-Control", "no-store");
              const send = (value: unknown) =>
                response.write(`${JSON.stringify(value)}\n`);
              try {
                const result = await importPostImages(
                  root,
                  input.folder,
                  input,
                  ({ completed, total }) =>
                    send({
                      type: "progress",
                      percent: Math.round((completed / total) * 100),
                    }),
                );
                send({ type: "result", ...result });
              } catch (error) {
                send({ type: "error", error: errorMessage(error) });
              }
              response.end();
              return;
            }
            return json(response, 404, { error: "Unknown Local CMS endpoint" });
          } catch (error) {
            const message = errorMessage(error);
            const status = /changed outside|confirm/i.test(message)
              ? 409
              : error instanceof ZodError
                ? 400
                : 400;
            return json(response, status, { error: message });
          }
        });
      },
    },
  };
}
