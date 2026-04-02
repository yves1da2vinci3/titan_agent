import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync } from "fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface FaqSection {
  title: string;
  content: string;
}

function loadFaqSections(): FaqSection[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const faqPath = join(here, "../../../src/faq/titan-faq.md");
  const raw = readFileSync(faqPath, "utf-8");
  const sections: FaqSection[] = [];
  const lines = raw.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = line.replace("## ", "").trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }
  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }
  return sections;
}

const faqSections = loadFaqSections();

const searchFaqSchema = z.object({
  query: z.string(),
});

export const searchFaqTool = new DynamicStructuredTool({
  name: "searchFAQ",
  description:
    "Recherche dans la base de connaissance Titan Telecom. À utiliser pour les questions sur les forfaits, paiements, cadeaux, défis ou connexion WiFi.",
  schema: searchFaqSchema,
  func: async ({ query }: { query: string }): Promise<string> => {
    const q = query.toLowerCase();
    const results = faqSections.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q)
    );
    if (results.length === 0) {
      return "Aucune information trouvée dans la FAQ pour cette requête.";
    }
    return results
      .slice(0, 2)
      .map((r) => `### ${r.title}\n${r.content}`)
      .join("\n\n---\n\n");
  },
});
