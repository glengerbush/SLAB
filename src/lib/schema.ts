import { z } from "zod";

import { socialIconNames } from "./social-icon-names";

const isoDate = z
  .union([z.string(), z.date()])
  .transform((value) =>
    value instanceof Date ? value.toISOString().slice(0, 10) : value,
  )
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return (
          !Number.isNaN(date.valueOf()) &&
          date.toISOString().slice(0, 10) === value
        );
      }, "Use a real calendar date"),
  );

const optionalIsoDate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  isoDate.optional(),
);

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase kebab-case");

const mediaPath = z.preprocess(
  (value) => (value === "" ? null : value),
  z
    .string()
    .regex(
      /^\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]+$/,
      "Use a root-relative media path",
    )
    .refine(
      (value) => /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(value),
      "Use a web image file",
    )
    .nullable(),
);

const safeHref = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      (value.startsWith("/") && !value.startsWith("//")) ||
      /^(?:#|https:\/\/|mailto:)/.test(value),
    "Use a root-relative path, HTTPS URL, anchor, or email link",
  );

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color")
  .transform((value) => value.toUpperCase());

export const postDataSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(320),
    slug: slugSchema,
    draft: z.boolean(),
    published: optionalIsoDate,
    updated: optionalIsoDate,
    tags: z
      .array(z.string().trim().min(1).max(50))
      .transform((tags) => [...new Set(tags)])
      .default([]),
    aliases: z.array(slugSchema).default([]),
    socialImage: mediaPath.default(null),
  })
  .superRefine((value, context) => {
    if (!value.draft && !value.published) {
      context.addIssue({
        code: "custom",
        path: ["published"],
        message: "Ready posts require a publication date",
      });
    }
    if (value.updated && value.published && value.updated < value.published) {
      context.addIssue({
        code: "custom",
        path: ["updated"],
        message: "Updated date cannot precede publication date",
      });
    }
    if (value.aliases.includes(value.slug)) {
      context.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "An Alias cannot match the current Slug",
      });
    }
    if (new Set(value.aliases).size !== value.aliases.length) {
      context.addIssue({
        code: "custom",
        path: ["aliases"],
        message: "Aliases cannot contain duplicates",
      });
    }
  });

export const siteSettingsSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(320),
  author: z.string().trim().min(1).max(100),
  domain: z
    .url()
    .refine((value) => value.startsWith("https://"), "Use an HTTPS domain")
    .transform((value) => value.replace(/\/$/, "")),
  locale: z
    .string()
    .trim()
    .min(2)
    .max(35)
    .refine((value) => {
      try {
        new Intl.Locale(value);
        return true;
      } catch {
        return false;
      }
    }, "Use a valid BCP 47 locale"),
  accentColor: hexColor.default("#BC5215"),
  navigation: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        href: safeHref,
      }),
    )
    .max(12),
  socialLinks: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(40),
        href: z
          .url()
          .refine((value) => value.startsWith("https://"), "Use an HTTPS URL"),
        icon: z.enum(socialIconNames).default("auto"),
      }),
    )
    .max(20),
  defaultSocialImage: mediaPath,
  robots: z.object({
    index: z.boolean(),
    follow: z.boolean(),
    allowAiTraining: z.boolean(),
    advancedRules: z
      .string()
      .max(5000)
      .refine(
        (value) => !/[\0\r]/.test(value),
        "Rules contain invalid control characters",
      ),
  }),
  frames: z
    .array(
      z
        .url()
        .refine(
          (value) => value.startsWith("https://"),
          "Use an HTTPS frame origin",
        ),
    )
    .max(30),
});

export type PostData = z.infer<typeof postDataSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;
