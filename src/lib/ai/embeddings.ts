import { prisma } from "@/lib/prisma";
import { generateEmbedding, generateEmbeddingsBatch } from "./gemini";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateProductEmbeddings(): Promise<number> {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { category: true },
  });

  // Filter products that don't have embeddings yet
  const existing = await prisma.productEmbedding.findMany({
    select: { productId: true },
  });
  const existingIds = new Set(existing.map((e) => e.productId));
  const toEmbed = products.filter((p) => !existingIds.has(p.id));

  if (toEmbed.length === 0) return 0;

  // Create text representations for embedding
  const texts = toEmbed.map(
    (p) =>
      `${p.name}. Категорія: ${p.category.name}. ${p.description}. Ціна: ${p.price} грн.`
  );

  // Process in batches of 100
  const batchSize = 100;
  let count = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchProducts = toEmbed.slice(i, i + batchSize);
    const embeddings = await generateEmbeddingsBatch(batch);

    for (let j = 0; j < embeddings.length; j++) {
      await prisma.productEmbedding.upsert({
        where: { productId: batchProducts[j].id },
        create: {
          productId: batchProducts[j].id,
          embedding: JSON.stringify(embeddings[j]),
          textContent: texts[i + j],
        },
        update: {
          embedding: JSON.stringify(embeddings[j]),
          textContent: texts[i + j],
        },
      });
      count++;
    }
  }

  return count;
}

export async function semanticSearch(
  query: string,
  limit: number = 10
): Promise<{ productId: string; score: number }[]> {
  const allEmbeddings = await prisma.productEmbedding.findMany();
  if (allEmbeddings.length === 0) return [];

  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const scored = allEmbeddings
    .map((entry) => {
      try {
        const embedding = JSON.parse(entry.embedding) as number[];
        if (embedding.length !== queryEmbedding.length) return null;
        const score = cosineSimilarity(queryEmbedding, embedding);
        return { productId: entry.productId, score };
      } catch {
        return null;
      }
    })
    .filter((x): x is { productId: string; score: number } => x !== null);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function findSimilarProducts(
  productId: string,
  limit: number = 5
): Promise<{ productId: string; score: number }[]> {
  const productEmbedding = await prisma.productEmbedding.findUnique({
    where: { productId },
  });

  if (!productEmbedding) return [];

  const source = JSON.parse(productEmbedding.embedding) as number[];
  const allEmbeddings = await prisma.productEmbedding.findMany({
    where: { productId: { not: productId } },
  });

  const scored = allEmbeddings.map((entry) => {
    const embedding = JSON.parse(entry.embedding) as number[];
    const score = cosineSimilarity(source, embedding);
    return { productId: entry.productId, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
