import type { SiteSettings } from "./schema";

export const aiTrainingCrawlers = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "Amazonbot",
  "Meta-ExternalAgent",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "cohere-training-data-crawler",
] as const;

export function formatDate(date: string, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(`${date}T00:00:00Z`));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")}, ${part("year")}`;
}

export function absoluteUrl(settings: SiteSettings, path: string) {
  return new URL(path, `${settings.domain}/`).href;
}

export function openGraphLocale(locale: string) {
  return locale.replaceAll("-", "_");
}

export function socialImagePath(
  settings: Pick<SiteSettings, "defaultSocialImage">,
  postImage?: string | null,
) {
  return postImage ?? settings.defaultSocialImage;
}

function normalizeHex(hex: string) {
  return hex.toUpperCase();
}

function hexChannels(hex: string) {
  return normalizeHex(hex)
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16));
}

function relativeLuminance(hex: string) {
  const channels = hexChannels(hex)
    .map((value) => value / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

function mixHex(first: string, second: string, amount: number) {
  const firstChannels = hexChannels(first);
  const secondChannels = hexChannels(second);
  const channels = firstChannels.map((value, index) =>
    Math.round(value + (secondChannels[index] - value) * amount),
  );
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function readableAccent(accent: string, scheme: "light" | "dark") {
  const backgrounds =
    scheme === "light" ? ["#FFFCF0", "#F2F0E5"] : ["#100F0F", "#1C1B1A"];
  const target = scheme === "light" ? "#100F0F" : "#FFFCF0";
  const passes = (candidate: string) =>
    backgrounds.every(
      (background) => contrastRatio(candidate, background) >= 4.5,
    );
  const normalized = normalizeHex(accent);
  if (passes(normalized)) return normalized;
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixHex(normalized, target, step / 100);
    if (passes(candidate)) return candidate;
  }
  return target;
}

export function accentContrast(accent: string) {
  const paletteCandidates = ["#FFFCF0", "#100F0F"].sort(
    (first, second) =>
      contrastRatio(second, accent) - contrastRatio(first, accent),
  );
  if (contrastRatio(paletteCandidates[0], accent) >= 4.5)
    return paletteCandidates[0];
  return ["#FFFFFF", "#000000"].sort(
    (first, second) =>
      contrastRatio(second, accent) - contrastRatio(first, accent),
  )[0];
}

export function robotsText(settings: SiteSettings) {
  const lines = [
    "User-agent: *",
    `Content-Signal: ai-train=${settings.robots.allowAiTraining ? "yes" : "no"}`,
  ];
  if (settings.robots.index) {
    lines.push("Allow: /");
  } else {
    lines.push("Disallow: /");
  }
  if (!settings.robots.allowAiTraining) {
    for (const crawler of aiTrainingCrawlers) {
      lines.push("", `User-agent: ${crawler}`, "Disallow: /");
    }
  }
  if (settings.robots.advancedRules.trim()) {
    lines.push("", settings.robots.advancedRules.trim());
  }
  if (settings.robots.index) {
    lines.push("", `Sitemap: ${absoluteUrl(settings, "/sitemap.xml")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function tdmReservationText(settings: SiteSettings) {
  return `${JSON.stringify(
    [
      {
        location: "/",
        "tdm-reservation": settings.robots.allowAiTraining ? 0 : 1,
      },
    ],
    null,
    2,
  )}\n`;
}
