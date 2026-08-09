import { deletePost, listPostDocuments } from "./repository";
import { readSiteSettings } from "./settings";

export async function deletePersistedPost(
  root: string,
  folder: string,
  expectedRevision: string,
) {
  const [posts, settings] = await Promise.all([
    listPostDocuments(root),
    readSiteSettings(root),
  ]);
  const mediaPrefix = `/media/${folder}/`;
  const externalReferences = [
    settings.defaultSocialImage ?? "",
    ...posts
      .filter((post) => post.folder !== folder)
      .flatMap((post) => [post.body, post.socialImage ?? ""]),
  ];
  if (externalReferences.some((reference) => reference.includes(mediaPrefix))) {
    throw new Error(
      "Remove every saved reference to this Post’s media before deleting the Post",
    );
  }
  return deletePost(root, folder, expectedRevision);
}
