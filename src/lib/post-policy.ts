export const postFolderPattern = /^\d{2}-\d{2}-\d{2}--[a-z0-9][a-z0-9-]*$/;

export function assertPostFolderName(folder: string) {
  if (!postFolderPattern.test(folder)) {
    throw new Error(
      `Invalid post folder "${folder}"; expected YY-MM-DD--label`,
    );
  }
  return folder;
}

export function fileLabel(value: string, fallback: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || fallback
  );
}
