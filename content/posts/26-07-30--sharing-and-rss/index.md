---
title: Set up sharing, feeds, and discovery
description: Configure social previews, RSS, crawler controls, and the metadata
  generated for every page.
slug: sharing-feeds-and-discovery
draft: false
published: 2026-07-30
tags:
  - Getting Started
  - Publishing
aliases: []
socialImage: null
---

Site Settings gathers the information used beyond the visible Post: the canonical domain, locale, Blog description, social links, and default Social Image. Social links appear as icons in the Published Site footer.

Each Post can override that default with one of its own images. The build then creates canonical and social metadata without requiring a browser script.

The template also generates:

1. an [RSS feed](/rss.xml) containing every Published Post;
2. a sitemap containing Posts, Tags, and standalone Pages;
3. page-level robots metadata for the indexing and link-following controls;
4. a `robots.txt` file with indexing rules, a general AI-training preference, explicit rules for known training and dataset crawlers, and any advanced rules entered in Settings;
5. a `/.well-known/tdmrep.json` file that declares whether the site permits text and data mining.

Social links use local SVG icons, so the Published Site does not contact an icon or favicon service.
