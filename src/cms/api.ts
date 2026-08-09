import type {
  Bootstrap,
  MediaAsset,
  PostDocument,
  SiteSettings,
} from "./types";

export type ImageImportProgress =
  | { phase: "uploading"; percent: number }
  | { phase: "converting"; percent: number };

interface ImageImportResult {
  files: string[];
  markup: string;
  primary: string;
}

interface SyncResult {
  changed: string[];
  revision: string | null;
}

export interface GiscusCategory {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
}

type ImageStreamMessage<T> =
  | { type: "progress"; percent: number }
  | ({ type: "result" } & T)
  | { type: "error"; error: string };

const token =
  document.querySelector<HTMLMetaElement>('meta[name="local-cms-token"]')
    ?.content ?? "";
const prefix = "/api/local-cms";

async function request<T>(path: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const response = await fetch(`${prefix}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { "X-Local-CMS-Token": token } : {}),
      ...init.headers,
    },
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(value.error ?? `Request failed (${response.status})`);
  return value;
}

function importImages<T>(
  path: string,
  input: Record<string, unknown>,
  onProgress?: (progress: ImageImportProgress) => void,
) {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    let offset = 0;
    let pending = "";
    let result: T | undefined;
    let streamError = "";

    const handle = (line: string) => {
      if (!line.trim()) return;
      const message = JSON.parse(line) as ImageStreamMessage<T>;
      if (message.type === "progress")
        onProgress?.({ phase: "converting", percent: message.percent });
      else if (message.type === "result") {
        const { type: _type, ...value } = message;
        result = value as T;
      } else streamError = message.error;
    };

    const consume = (final = false) => {
      pending += request.responseText.slice(offset);
      offset = request.responseText.length;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handle(line);
      if (final && pending) {
        handle(pending);
        pending = "";
      }
    };

    request.open("POST", `${prefix}${path}`);
    request.setRequestHeader("Content-Type", "application/json");
    request.setRequestHeader("X-Local-CMS-Token", token);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({
          phase: "uploading",
          percent: Math.round((event.loaded / event.total) * 100),
        });
      }
    };
    request.upload.onload = () =>
      onProgress?.({ phase: "converting", percent: 0 });
    request.onerror = () => reject(new Error("Image import failed"));
    request.onprogress = () => consume();
    request.onload = () => {
      try {
        consume(true);
      } catch {
        reject(new Error(`Request failed (${request.status})`));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(streamError || `Request failed (${request.status})`));
        return;
      }
      if (streamError) {
        reject(new Error(streamError));
        return;
      }
      if (!result) {
        reject(new Error("Image import returned no result"));
        return;
      }
      resolve(result);
    };
    onProgress?.({ phase: "uploading", percent: 0 });
    request.send(JSON.stringify(input));
  });
}

export const api = {
  bootstrap: () => request<Bootstrap>("/bootstrap"),
  sync: (folder?: string) =>
    request<SyncResult>(
      `/sync${folder ? `?folder=${encodeURIComponent(folder)}` : ""}`,
    ),
  changed: () => request<{ changed: string[] }>("/changed"),
  post: (folder: string) =>
    request<PostDocument>(`/posts/${encodeURIComponent(folder)}`),
  createPost: (
    input: Pick<
      PostDocument,
      | "title"
      | "description"
      | "slug"
      | "draft"
      | "published"
      | "updated"
      | "tags"
      | "aliases"
      | "socialImage"
      | "body"
    >,
  ) =>
    request<PostDocument>("/posts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  savePost: (
    post: PostDocument,
    expectedRevision: string,
    confirmSlugChange: boolean,
  ) =>
    request<PostDocument>(`/posts/${encodeURIComponent(post.folder)}`, {
      method: "PUT",
      body: JSON.stringify({ post, expectedRevision, confirmSlugChange }),
    }),
  deletePost: (folder: string, expectedRevision: string) =>
    request<{ deleted: string }>(`/posts/${encodeURIComponent(folder)}`, {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision }),
    }),
  settings: () =>
    request<{ settings: SiteSettings; settingsRevision: string }>("/settings"),
  saveSettings: (settings: SiteSettings, expectedRevision: string) =>
    request<{
      settings: SiteSettings;
      settingsRevision: string;
      robots: string;
    }>("/settings", {
      method: "PUT",
      body: JSON.stringify({ settings, expectedRevision }),
    }),
  discoverComments: (repository: string) =>
    request<{
      repository: string;
      repositoryId: string;
      categories: GiscusCategory[];
      selectedCategory: GiscusCategory | null;
    }>(`/comments/discover?repository=${encodeURIComponent(repository)}`),
  parseCommentsScript: (script: string) =>
    request<NonNullable<SiteSettings["comments"]>>("/comments/parse", {
      method: "POST",
      body: JSON.stringify({ script }),
    }),
  missingCommentKeys: () => request<{ count: number }>("/comments/missing"),
  removeCommentsSetup: (expectedRevision: string, confirmation: string) =>
    request<{
      settings: SiteSettings;
      settingsRevision: string;
      removedKeys: number;
    }>("/comments/setup", {
      method: "DELETE",
      body: JSON.stringify({ expectedRevision, confirmation }),
    }),
  commentDiscussion: (folder: string) =>
    request<{ url: string | null }>(
      `/comments/discussion?folder=${encodeURIComponent(folder)}`,
    ),
  media: (folder: string) =>
    request<MediaAsset[]>(`/media/${encodeURIComponent(folder)}`),
  insertMedia: (
    folder: string,
    input: {
      layout: "single" | "pair";
      assets: Array<{ id: string; scope: "post" | "shared" }>;
      alts: string[];
      caption?:
        | { type: "shared"; text: string }
        | { type: "individual"; texts: [string, string] };
    },
  ) =>
    request<{ markup: string }>(`/media/${encodeURIComponent(folder)}/insert`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteMedia: (folder: string, assetId: string) =>
    request<{
      deleted: string[];
      media: MediaAsset[];
    }>(`/media/${encodeURIComponent(folder)}/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
    }),
  image: (
    input: Record<string, unknown>,
    onProgress?: (progress: ImageImportProgress) => void,
  ) => importImages<ImageImportResult>("/images", input, onProgress),
  library: () => request<MediaAsset[]>("/library"),
  libraryImage: (
    input: Record<string, unknown>,
    onProgress?: (progress: ImageImportProgress) => void,
  ) =>
    importImages<{ files: string[]; media: MediaAsset[] }>(
      "/library/images",
      input,
      onProgress,
    ),
  deleteLibraryMedia: (assetId: string) =>
    request<{ deleted: string[]; media: MediaAsset[] }>(
      `/library/${encodeURIComponent(assetId)}`,
      { method: "DELETE" },
    ),
};
