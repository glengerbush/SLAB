import { expect, test } from "vitest";

import {
  accentContrast,
  aiTrainingCrawlers,
  contrastRatio,
  openGraphLocale,
  readableAccent,
  robotsText,
  socialImagePath,
  tdmReservationText,
} from "../src/lib/presentation";
import type { SiteSettings } from "../src/lib/schema";

const settings = { defaultSocialImage: "/media/shared/default.avif" };

const siteSettings = {
  domain: "https://example.com",
  robots: {
    index: true,
    follow: true,
    allowAiTraining: false,
    advancedRules: "",
  },
} as SiteSettings;

test("uses the site Social Image when a Post has none", () => {
  expect(socialImagePath(settings, null)).toBe("/media/shared/default.avif");
  expect(socialImagePath(settings, undefined)).toBe(
    "/media/shared/default.avif",
  );
});

test("a Post Social Image overrides the site default", () => {
  expect(socialImagePath(settings, "/media/post/specific.avif")).toBe(
    "/media/post/specific.avif",
  );
});

test("normalizes every Open Graph locale separator", () => {
  expect(openGraphLocale("zh-Hant-TW")).toBe("zh_Hant_TW");
});

test.each(["#000000", "#FFFFFF", "#767676", "#BC5215", "#FFFF00"])(
  "chooses readable text for accent %s",
  (accent) => {
    expect(
      contrastRatio(accentContrast(accent), accent),
    ).toBeGreaterThanOrEqual(4.5);
  },
);

test.each([
  ["light", ["#FFFCF0", "#F2F0E5"]],
  ["dark", ["#100F0F", "#1C1B1A"]],
] as const)("derives a readable %s accent", (scheme, backgrounds) => {
  for (const accent of ["#BC5215", "#FFFF00", "#100F0F", "#FFFCF0"]) {
    const readable = readableAccent(accent, scheme);
    for (const background of backgrounds) {
      expect(contrastRatio(readable, background)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("publishes layered AI-training opt-outs", () => {
  const robots = robotsText(siteSettings);

  expect(robots).toContain("Content-Signal: ai-train=no");
  for (const crawler of aiTrainingCrawlers) {
    expect(robots).toContain(`User-agent: ${crawler}\nDisallow: /`);
  }
  expect(JSON.parse(tdmReservationText(siteSettings))).toEqual([
    { location: "/", "tdm-reservation": 1 },
  ]);
});

test("publishes affirmative AI-training preferences when allowed", () => {
  const allowed = {
    ...siteSettings,
    robots: { ...siteSettings.robots, allowAiTraining: true },
  };

  expect(robotsText(allowed)).toContain("Content-Signal: ai-train=yes");
  expect(robotsText(allowed)).not.toContain("User-agent: GPTBot");
  expect(JSON.parse(tdmReservationText(allowed))).toEqual([
    { location: "/", "tdm-reservation": 0 },
  ]);
});
