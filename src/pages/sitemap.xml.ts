import { loadSite } from "../lib/content";
import { absoluteUrl } from "../lib/presentation";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function GET() {
  const site = await loadSite();
  const paths = [
    "/",
    "/about/",
    "/tags/",
    ...site.posts.map((post) => `/posts/${post.slug}/`),
    ...[...site.tags.keys()].map((tag) => `/tags/${tag}/`),
  ];
  const urls = paths
    .map(
      (path) =>
        `<url><loc>${escapeXml(absoluteUrl(site.settings, path))}</loc></url>`,
    )
    .join("");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    },
  );
}
