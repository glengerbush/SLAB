import {
  siBluesky,
  siFacebook,
  siGithub,
  siInstagram,
  siMastodon,
  siReddit,
  siThreads,
  siTiktok,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";

import type { SocialIconName } from "./social-icon-names";

const icons: Partial<Record<SocialIconName, SimpleIcon>> = {
  bluesky: siBluesky,
  facebook: siFacebook,
  github: siGithub,
  instagram: siInstagram,
  mastodon: siMastodon,
  reddit: siReddit,
  threads: siThreads,
  tiktok: siTiktok,
  x: siX,
  youtube: siYoutube,
};

const detected: Array<[RegExp, SocialIconName]> = [
  [/\b(?:bsky\.app|bluesky)\b/i, "bluesky"],
  [/\bfacebook\b/i, "facebook"],
  [/\bgithub\b/i, "github"],
  [/\binstagram\b/i, "instagram"],
  [/\bmastodon\b/i, "mastodon"],
  [/\breddit\b/i, "reddit"],
  [/\bthreads(?:\.net)?\b/i, "threads"],
  [/\btiktok\b/i, "tiktok"],
  [/\b(?:x\.com|twitter)\b/i, "x"],
  [/\b(?:youtube|youtu\.be)\b/i, "youtube"],
];

export function resolveSocialIcon(link: {
  icon: SocialIconName;
  label: string;
  href: string;
}) {
  const name =
    link.icon === "auto"
      ? (detected.find(([pattern]) =>
          pattern.test(`${link.label} ${link.href}`),
        )?.[1] ?? "link")
      : link.icon;
  return { name, icon: icons[name] ?? null };
}
