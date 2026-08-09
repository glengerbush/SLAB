import type { PostData, SiteSettings as Settings } from "./schema";

export type PostStatus = "Draft" | "Ready" | "Published" | "Unreleased";

export interface MediaAsset {
  scope: "post" | "shared";
  id: string;
  name: string;
  importedAt: string;
  kind: "raster" | "svg";
  files: string[];
  src: string;
  srcset?: string;
  width?: number;
  height?: number;
}

export interface PostDocument extends PostData {
  folder: string;
  body: string;
  images: string[];
  media: MediaAsset[];
  revision: string;
  status: PostStatus;
}

export type SiteSettings = Settings;

export interface CmsBootstrap {
  posts: PostDocument[];
  media: MediaAsset[];
  settings: SiteSettings;
  settingsRevision: string;
  changed: string[];
}
