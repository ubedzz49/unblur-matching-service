import { buildDbPool } from "../db/pool.js";
import { PostgresEmbeddingRepository } from "./postgres-repository.js";
import { OpenRouterEmbeddingProvider } from "./openrouter-provider.js";
import { logger } from "../logger.js";

// small delay between calls -- this is a one-off/occasional job (run again whenever
// new taxonomy rows are added), not a hot path, no need to hammer the provider
const DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const pool = buildDbPool();
  const repository = new PostgresEmbeddingRepository(pool);
  const provider = new OpenRouterEmbeddingProvider();

  // reads from user-service's tables -- same shared database, read-only from here
  const { rows } = await pool.query<{
    level_id: string;
    type_id: string;
    type_name: string;
    level_name: string;
  }>(
    `SELECT el.id AS level_id, et.id AS type_id, et.name AS type_name, el.name AS level_name
     FROM expertise_levels el
     JOIN expertise_types et ON et.id = el.expertise_type_id`,
  );

  logger.info({ count: rows.length }, "backfilling embeddings for taxonomy nodes");

  let done = 0;
  for (const row of rows) {
    const label = `${row.type_name} — ${row.level_name}`;
    const embedding = await provider.embed(label);
    await repository.upsert(row.level_id, row.type_id, label, embedding);
    done++;
    if (done % 20 === 0) logger.info({ done, total: rows.length }, "backfill progress");
    await sleep(DELAY_MS);
  }

  logger.info({ done }, "backfill complete");
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, "backfill failed");
  process.exit(1);
});
