import { loadSite } from "../../lib/content";
import { tdmReservationText } from "../../lib/presentation";

export async function GET() {
  const { settings } = await loadSite();
  return new Response(tdmReservationText(settings), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
