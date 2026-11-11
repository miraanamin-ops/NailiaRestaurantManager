import type { NextRequest } from "next/server";
import { appJson, withOwner } from "@/lib/app-api";
import { helpGuide } from "@/lib/app/more";

// More > Help: the owner help guide (agents/help.md) and the support email for "Talk to a person".
export async function GET(req: NextRequest) {
  return withOwner(req, async () => appJson(await helpGuide()));
}
