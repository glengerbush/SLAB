---
title: Publish safely with Git
description: Understand the final review, build, audit, push, and rollback
  workflow used by the template.
slug: publish-safely-with-git
draft: false
published: 2026-08-01
tags:
  - Getting Started
  - Publishing
aliases: []
socialImage: null
---

The Local CMS writes files, but it never commits or pushes them. You can review the change with your usual Git tools and run the same checks used by deployment:

```sh
npm run check
npm test
npm run test:e2e
npm run build
```

The build produces static HTML and audits the exact deployment artifact. Drafts, source settings, local CMS code, raster originals, repository paths, and undeclared files are excluded or rejected. Imported SVG files remain SVG and may be deployed.

Pushing `main` is the publication action. GitHub Actions builds the private repository and uploads only the audited `dist` directory to Cloudflare Pages.

Rollback stays equally plain: revert the unwanted Git change and push again.