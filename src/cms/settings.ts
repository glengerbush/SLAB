import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

import { siteSettingsSchema, type SiteSettings } from "../lib/schema";

const mutationTails = new Map<string, Promise<void>>();

function revision(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

async function withSettingsMutation<T>(
  root: string,
  mutation: () => Promise<T>,
) {
  const key = resolve(root);
  const previous = mutationTails.get(key) ?? Promise.resolve();
  const operation = previous.then(mutation);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(key, tail);
  try {
    return await operation;
  } finally {
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}

export async function readSiteSettingsDocument(root: string) {
  const path = resolve(root, "site.config.yaml");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Site Settings must be a real file");
  const source = await readFile(path, "utf8");
  return {
    settings: siteSettingsSchema.parse(YAML.parse(source)),
    revision: revision(source),
  };
}

export async function readSiteSettings(root: string) {
  return (await readSiteSettingsDocument(root)).settings;
}

export function saveSiteSettings(
  root: string,
  input: SiteSettings,
  expectedRevision: string,
) {
  return withSettingsMutation(root, async () => {
    const current = await readSiteSettingsDocument(root);
    if (current.revision !== expectedRevision) {
      throw new Error(
        "Site Settings changed outside the CMS; reload settings from file before saving",
      );
    }
    const settings = siteSettingsSchema.parse(input);
    const path = resolve(root, "site.config.yaml");
    const source = YAML.stringify(settings);
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, source, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
    return { settings, revision: revision(source) };
  });
}
