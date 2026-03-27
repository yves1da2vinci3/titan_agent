/**
 * Retire un éventuel bloc Markdown ```json ... ``` ou ``` ... ``` autour d'une chaîne
 * (sortie LLM qui n'a pas respecté le format JSON brut).
 */
export function stripMarkdownJsonFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*\n?([\s\S]*?)\s*```$/);
  if (m) {
    return m[1].trim();
  }
  return t;
}
