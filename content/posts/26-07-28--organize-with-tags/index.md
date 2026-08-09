---
title: Slugs and tags
description: Meet Slugs, Tags, Draft status, and the dates that describe a Post honestly.
slug: slugs-and-tags
draft: false
published: 2026-07-28
tags:
  - Getting Started
  - Organization
aliases: []
socialImage: null
---

A **Slug** defines the path to the Post URL. The slug for this Post is `permanent-urls-and-tags`, so its address ends in `/posts/permanent-urls-and-tags/`. The CMS creates a separate internal folder name. CMS logic relies on the folder name, so do not change it.

Tags connect related Posts without creating a complicated hierarchy. Add a few in the editor, then visit the [Tags index](/tags/) to browse all of them.

The Draft/Publish control decides whether a saved Post is eligible for the public build. It does not deploy the Post:

- Drafts can be committed safely, but never appear on the Published Site.
- The first Save with Publish selected sets the original Publication Date.
- Later reader-visible saves add or refresh the Updated Date.
- Dates can always be manually overridden in the CMS

If a Published Slug must change, the CMS confirms it and preserves the old one as a redirect Alias. Aliases can also be added manually.