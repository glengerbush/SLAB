export const socialIconNames = [
  "auto",
  "link",
  "bluesky",
  "facebook",
  "github",
  "instagram",
  "mastodon",
  "reddit",
  "threads",
  "tiktok",
  "x",
  "youtube",
] as const;

export type SocialIconName = (typeof socialIconNames)[number];
