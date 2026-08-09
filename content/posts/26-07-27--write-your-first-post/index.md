---
title: Write your first post
description: Learn where Posts live and how the Local CMS keeps visual editing
  and plain files together.
slug: write-your-first-post
draft: false
published: 2026-07-27
tags:
  - Getting Started
  - Writing
aliases: []
socialImage: null
---

Open the [local only CMS (content management system)](/cms/), choose **New post**. The editor makes it easy to post without the lock-in. Every Post remains an ordinary `index.md` file.

## Markdown and HTML

**Markdown / HTML** exposes the Post body’s source. Markdown and raw HTML can coexist in the same document.

- Markdown follows GitHub Flavored Markdown.
- Fenced code blocks can name a language after the opening backticks. Recognized languages receive build-time syntax highlighting from [Shiki](https://shiki.style/guide/); unknown languages remain escaped, readable plain code.
- **Visual** edits supported prose and image structures. Block HTML (including `<details>`, `<iframe>`, `<svg>`, and custom `<section>` elements) appears as locked Custom Content and must be edited in **Markdown / HTML**.
- Tables and task-list state are not reliably preserved after editing in the Visual tab. Keep those structures source-edited.
- Raw HTML is trusted Author content, but it is audited. Inline scripts, event-handler attributes, iframe `srcdoc`, executable URLs, and remote scripts are rejected.
- Remote iframe origins can be allowed under **Settings → Appearance → Allowed iframe origins**. Same-origin iframes need no entry.
- Script permissions are separate: only root-relative, same-origin module scripts are allowed. Adding an iframe origin does not authorize scripts from that origin.

After saving with **Publish** selected, use **View post** as the authoritative rendering.