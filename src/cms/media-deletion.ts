import { deletePostMedia } from "./images";
import { listPostDocuments } from "./repository";
import { readSiteSettings } from "./settings";

export async function deletePersistedPostMedia(
  root: string,
  folder: string,
  assetId: string,
) {
  const [posts, settings] = await Promise.all([
    listPostDocuments(root),
    readSiteSettings(root),
  ]);
  return deletePostMedia(root, folder, {
    assetId,
    references: [
      settings.defaultSocialImage ?? "",
      ...posts.flatMap((post) => [post.body, post.socialImage ?? ""]),
    ],
  });
}
