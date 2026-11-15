import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claude, fallbackFor, MODELS } from "@/lib/claude";

// Is a photo the owner just took fit to go in a customer email? Claude looks; the
// reasons and the words the owner sees are fixed (PHOTO_FIX). About 1p a photo.

export const PHOTO_PROBLEMS = ["ok", "too_dark", "blurry", "not_food", "person_or_child", "wrong_dish"] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];

export const PHOTO_FIX: Record<Exclude<PhotoProblem, "ok">, string> = {
  too_dark: "That one's too dark. Try it by a window or under bright lights.",
  blurry: "That one's a bit blurry. Hold steady and tap the dish to focus.",
  not_food: "We need the dish in the shot. Try a close-up of it.",
  person_or_child: "Someone's face is in it, so we can't send it to customers. Try one with just the food.",
  wrong_dish: "That doesn't look like the dish in this offer. Try a photo of that one.",
};

const Schema = z.object({
  problem: z.enum(PHOTO_PROBLEMS).describe("ok if usable; otherwise the main problem"),
});

export async function checkDishPhoto(image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }, dish: string, restaurantId: string): Promise<PhotoProblem> {
  const response = await claude("email_photo", restaurantId).beta.messages.parse({
    ...fallbackFor("haiku"),
    model: MODELS.haiku,
    max_tokens: 200,
    output_config: { format: betaZodOutputFormat(Schema) },
    system:
      "You check a photo a restaurant owner wants to put in a marketing email to customers. It must show food (ideally the named dish; a plate that could reasonably be it is fine), be bright and sharp enough to look appetising, and show no person's face and no child. Answer with the single main problem, or ok.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } },
          { type: "text", text: `The dish: ${dish.slice(0, 120)}` },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return "not_food";
  return response.parsed_output.problem;
}
