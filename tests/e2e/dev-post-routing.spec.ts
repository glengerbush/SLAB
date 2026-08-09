import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "./fixtures";

test("opens a Published Post added after Post routes were first requested", async ({
  page,
}) => {
  await page.goto("/posts/welcome/");
  await expect(
    page.getByRole("heading", { name: "Welcome to the example blog" }),
  ).toBeVisible();

  const root = (
    await readFile(resolve(".astro", "acceptance-root.txt"), "utf8")
  ).trim();
  const folder = resolve(root, "content", "posts", "26-08-07--late-added-post");
  await mkdir(folder);
  await writeFile(
    resolve(folder, "index.md"),
    `---
title: Late-added Post
description: A Published Post added after the dev route cache exists.
slug: late-added-post
draft: false
published: 2026-08-07
tags: []
aliases: []
socialImage: null
---

This Post should open without restarting development.
`,
  );

  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Late-added Post" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Late-added Post" }).click();

  await expect(page).toHaveURL(/\/posts\/late-added-post\/$/);
  await expect(
    page.getByRole("heading", { name: "Late-added Post" }),
  ).toBeVisible();

  const missing = await page.goto("/posts/not-a-post/");
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Page not found" }),
  ).toBeVisible();
});
