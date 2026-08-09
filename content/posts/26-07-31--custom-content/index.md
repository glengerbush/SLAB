---
title: Go beyond the visual editor
description: Keep unusual HTML and SVG as Custom Content while the standard
  editor stays focused and predictable.
slug: custom-content
draft: false
published: 2026-07-31
tags:
  - Advanced
  - Customization
aliases: []
socialImage: null
---

The visual editor is intentionally optimized for standard writing. When a Post needs something unusual, switch to its source or edit the Markdown file directly.

Trusted HTML becomes locked **Custom Content** in the visual editor so it won't break silently, though it can be deleted. This native disclosure element is one example:

<details>
  <summary>What remains possible?</summary>
  <p>Tables, inline SVG, configured iframes, and same-origin module enhancements can live beside ordinary Markdown.</p>
</details>

Add remote iframe origins under **Settings → Appearance → Allowed iframe origins**; same-origin iframes need no entry. A module enhancement must be root-relative and same-origin. Place its file under `public/` and declare its output path in `deployment.manifest.json`.

Inline SVG works too:

<svg viewBox="0 0 640 120" role="img" aria-labelledby="custom-content-title">
  <title id="custom-content-title">Three connected circles representing Markdown, HTML, and static output</title>
  <path d="M130 60h380" stroke="currentColor" stroke-width="6"/>
  <circle cx="130" cy="60" r="38" fill="#BC5215"/>
  <circle cx="320" cy="60" r="38" fill="#D0A215"/>
  <circle cx="510" cy="60" r="38" fill="#24837B"/>
</svg>

Executable inline scripts, event attributes, iframe `srcdoc`, unsafe URLs, and remote scripts are rejected. Content should remain readable with JavaScript disabled.