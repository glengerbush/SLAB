import { loadSite } from "../lib/content";
import { robotsText } from "../lib/presentation";

export async function GET() {
  const { settings } = await loadSite();
  return new Response(robotsText(settings), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
