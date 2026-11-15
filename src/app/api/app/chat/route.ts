import { after, type NextRequest } from "next/server";
import { appError, appJson, restaurantFor, withOwner } from "@/lib/app-api";
import { chatState, chatTurn, fileTurn, ON_IT_APP_MS, UploadRefused } from "@/lib/app/chat";
import { checkRow } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The app's Chat tab (step 50, phase 3). GET: the conversation (WhatsApp and app
// alike), newest 60, or the 60 before ?before=<time>. POST: one message (typed words,
// a tapped quick reply, or a file already uploaded through /api/app/chat/upload),
// answered by the WhatsApp bot's own engine; the answer is the conversation after it.
// An offer request writes and checks a whole campaign in this request (several AI
// calls), which can run past two minutes: the same limit as the job workers.
export const maxDuration = 300;

async function restaurant(id: string) {
  return checkRow(await getSupabase().from("restaurants").select("*").eq("id", id).maybeSingle<Restaurant>());
}

export async function GET(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const before = req.nextUrl.searchParams.get("before");
    if (before && Number.isNaN(Date.parse(before))) return appError(400, "bad_before");
    return appJson(await chatState(await restaurant(id), before));
  });
}

type Body = { text?: unknown; payload?: unknown; clientId?: unknown; file?: { path?: unknown; name?: unknown; contentType?: unknown } | null };

export async function POST(req: NextRequest) {
  return withOwner(req, async (owner) => {
    const id = restaurantFor(owner, req.nextUrl.searchParams.get("r"));
    if (!id) return appError(404, "no_restaurant");
    const body = (await req.json().catch(() => null)) as Body | null;
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, 1600) : "";
    const payload = typeof body?.payload === "string" && body.payload.length <= 200 ? body.payload : null;
    const clientId = typeof body?.clientId === "string" ? body.clientId : null;
    const file = body?.file && typeof body.file.path === "string" ? { path: body.file.path, name: String(body.file.name ?? ""), contentType: String(body.file.contentType ?? "") } : null;
    if (!text && !payload && !file) return appError(400, "empty");
    const r = await restaurant(id);
    try {
      // A quick answer comes back with the reply. A longer job: once "On it" is in the
      // chat, the app gets its answer and the work carries on here in the background;
      // the app checks for the reply (chatState's working).
      const work = file ? fileTurn(r, file, text, clientId) : chatTurn(r, { body: text, payload, clientId });
      const settled = work.then(
        (out) => ({ out, err: null as unknown }),
        (err: unknown) => ({ out: null, err }),
      );
      const quick = await Promise.race([settled, new Promise<null>((resolve) => setTimeout(() => resolve(null), ON_IT_APP_MS + 1500))]);
      if (!quick) {
        after(() => settled.then(({ err }) => err && console.error("Background chat turn failed", err)));
        return appJson({ duplicate: false, ...(await chatState(r)) });
      }
      if (quick.err) throw quick.err;
      return appJson({ duplicate: quick.out!.duplicate, ...(await chatState(r)) });
    } catch (err) {
      if (err instanceof UploadRefused) return appJson({ refused: err.message, ...(await chatState(r)) });
      throw err;
    }
  });
}
