import rss from "@astrojs/rss";
import { loadSite } from "../lib/content";
import { renderMarkdown } from "../lib/markdown";

export async function GET() {
  const { settings, posts } = await loadSite();
  const items = await Promise.all(
    posts.map(async (post) => ({
      title: post.title,
      description: post.description,
      pubDate: new Date(`${post.published}T00:00:00Z`),
      link: `/posts/${post.slug}/`,
      content: await renderMarkdown(post.body, {
        baseUrl: new URL(`/posts/${post.slug}/`, settings.domain).href,
      }),
    })),
  );
  return rss({
    title: settings.title,
    description: settings.description,
    site: settings.domain,
    customData: `<language>${settings.locale}</language>`,
    items,
  });
}
