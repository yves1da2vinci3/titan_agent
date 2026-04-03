import { JsonMarkdownStructuredOutputParser } from "@langchain/core/output_parsers";
import { z } from "zod";

/** Schéma unique pour la réponse agent (aligné sur le StructuredOutputParser LangChain). */
export const TitanChatReplySchema = z.object({
  text: z.string(),
});

export const titanStructuredOutputParser =
  JsonMarkdownStructuredOutputParser.fromZodSchema(TitanChatReplySchema);

/**
 * Extrait un candidat JSON (même heuristique que StructuredOutputParser.parse côté fences),
 * puis tente un objet `{"text":...}` en prolongeant depuis le premier `{` si besoin.
 */
function coerceLooseTitanJson(input: string): unknown {
  const t = input.trim();
  const candidate =
    t.match(/^```(?:json)?\s*([\s\S]*?)```/)?.[1] ||
    t.match(/```json\s*([\s\S]*?)```/)?.[1] ||
    t;
  try {
    return JSON.parse(candidate.trim());
  } catch {
    /* continue */
  }
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== "{") continue;
    const head = t.slice(i);
    if (!/^\{\s*"text"\s*:/.test(head)) continue;
    for (let end = i + 1; end <= t.length; end++) {
      try {
        return JSON.parse(t.slice(i, end));
      } catch {
        /* segment incomplet */
      }
    }
  }
  return null;
}

const LooseTitanReplySchema = z.preprocess((val: unknown) => {
  if (typeof val !== "string") return val;
  const coerced = coerceLooseTitanJson(val);
  if (coerced === null) return val;
  return coerced;
}, TitanChatReplySchema);

/**
 * Parse principal : LangChain (fences + validation Zod), puis repli Zod sur JSON partiel.
 */
export async function parseTitanReplyToPlainText(raw: string): Promise<string> {
  const t = raw.trim();
  if (!t) return "";
  try {
    const parsed = await titanStructuredOutputParser.parse(t);
    return parsed.text.trim();
  } catch {
    const loose = LooseTitanReplySchema.safeParse(t);
    if (loose.success) return loose.data.text.trim();
    return t;
  }
}

/**
 * Même logique sans LangChain (sync) — pour le client ou chemins sans await.
 */
export function parseTitanReplyToPlainTextSync(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const loose = LooseTitanReplySchema.safeParse(t);
  if (loose.success) return loose.data.text.trim();
  return t;
}
