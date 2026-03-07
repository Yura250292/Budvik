/**
 * Script to generate product embeddings for AI semantic search.
 * Run: npx tsx scripts/generate-embeddings.ts
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAQ9V_t1Cv1y-xAk0E5eq6IiyaYWkPJi_w";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

async function main() {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
    });

    console.log(`Found ${products.length} active products`);

    // Check existing embeddings
    const existing = await prisma.productEmbedding.findMany({
      select: { productId: true },
    });
    const existingIds = new Set(existing.map((e: any) => e.productId));
    const toEmbed = products.filter((p: any) => !existingIds.has(p.id));

    if (toEmbed.length === 0) {
      console.log("All products already have embeddings. Done.");
      return;
    }

    console.log(`Generating embeddings for ${toEmbed.length} products...`);

    // Process in batches of 20
    const batchSize = 20;
    let processed = 0;

    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map(
        (p: any) =>
          `${p.name}. Категорія: ${p.category.name}. ${p.description}. Ціна: ${p.price} грн.`
      );

      const res = await fetch(
        `${GEMINI_BASE_URL}/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: texts.map((text: string) => ({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text }] },
            })),
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        console.error(`Batch error: ${err}`);
        continue;
      }

      const data = await res.json();
      const embeddings = data.embeddings || [];

      for (let j = 0; j < embeddings.length; j++) {
        await prisma.productEmbedding.upsert({
          where: { productId: batch[j].id },
          create: {
            productId: batch[j].id,
            embedding: JSON.stringify(embeddings[j].values),
            textContent: texts[j],
          },
          update: {
            embedding: JSON.stringify(embeddings[j].values),
            textContent: texts[j],
          },
        });
        processed++;
      }

      console.log(`Processed ${processed}/${toEmbed.length}`);

      // Rate limiting: small delay between batches
      if (i + batchSize < toEmbed.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log(`Done! Generated embeddings for ${processed} products.`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
