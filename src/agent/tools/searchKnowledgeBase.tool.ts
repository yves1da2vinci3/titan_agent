import { DynamicStructuredTool } from "@langchain/core/tools";
import { Pool } from "pg";
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";
import { VoyageEmbeddings } from "@langchain/community/embeddings/voyage";
import { z } from "zod";
import { env } from "../../config/env.js";

const schema = z.object({
  query: z.string().describe("Question ou mots-clés pour chercher dans les documents importés"),
});

let storePromise: Promise<PGVectorStore> | null = null;

function kbConfigured(): boolean {
  return Boolean(env.DATABASE_URL && env.VOYAGE_API_KEY);
}

async function getVectorStore(): Promise<PGVectorStore> {
  if (!kbConfigured()) {
    throw new Error("RAG non configuré (DATABASE_URL et VOYAGE_API_KEY requis)");
  }
  if (!storePromise) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const embeddings = new VoyageEmbeddings({
      apiKey: env.VOYAGE_API_KEY,
      modelName: env.VOYAGE_EMBEDDING_MODEL,
      inputType: "query",
    });
    storePromise = PGVectorStore.initialize(embeddings, {
      pool,
      tableName: "titan_kb_embeddings",
      columns: {
        idColumnName: "id",
        vectorColumnName: "embedding",
        contentColumnName: "text",
        metadataColumnName: "metadata",
      },
      dimensions: env.KB_VECTOR_DIMENSIONS,
    });
  }
  return storePromise;
}

export const searchKnowledgeBaseTool = new DynamicStructuredTool({
  name: "searchKnowledgeBase",
  description:
    "Recherche sémantique dans les documents uploadés (base de connaissances Titan). À utiliser pour des infos issues de fichiers PDF/TXT importés par l’admin, en complément de searchFAQ.",
  schema,
  func: async ({ query }: { query: string }): Promise<string> => {
    if (!kbConfigured()) {
      return "La base documentaire n’est pas disponible (configuration serveur manquante). Utilise searchFAQ pour la FAQ générale.";
    }
    const q = query.trim();
    if (!q) {
      return "Précise ta question pour chercher dans la base documentaire.";
    }
    try {
      const store = await getVectorStore();
      const docs = await store.similaritySearch(q, 5);
      if (docs.length === 0) {
        return "Aucun extrait pertinent trouvé dans les documents importés pour cette requête.";
      }
      const parts = docs.map((d, i) => {
        const meta = d.metadata && Object.keys(d.metadata).length ? ` [${JSON.stringify(d.metadata)}]` : "";
        return `[${i + 1}]${meta}\n${d.pageContent}`;
      });
      return parts.join("\n\n---\n\n");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Erreur lors de la recherche dans la base documentaire: ${msg}`;
    }
  },
});
