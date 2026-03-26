import { DynamicTool } from "@langchain/core/tools";
import { readFileSync } from "fs";
import { join } from "path";

interface FaqSection {
  title: string;
  content: string;
}

function loadFaqSections(): FaqSection[] {
  const faqPath = join(__dirname, "../../faq/titan-faq.md");
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

export const searchFaqTool = new DynamicTool({
  name: "searchFAQ",
  description:
    "Recherche dans la base de connaissance Titan Telecom. Utilise cet outil avant de répondre à une question sur les forfaits, les paiements, les cadeaux, les défis ou la connexion.",
  func: async (query: string): Promise<string> => {
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
      .map((r) => `### ${r.title}\n${r.content}`)
      .join("\n\n---\n\n");
  },
});
