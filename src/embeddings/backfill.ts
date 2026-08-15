import { Pool } from "pg";
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

// expertise_levels/expertise_types live in User Service's own database, a separate database
// from Matching Service's own (each service has always had its own database -- this was never
// actually "the same shared database" the way the old comment here claimed). Reusing
// buildDbPool()'s connection for the read side pointed it at expertise_embeddings' own database,
// where expertise_levels/expertise_types don't exist -- every real run of this script failed
// immediately with "relation \"expertise_levels\" does not exist", which is exactly why
// expertise_embeddings has sat empty in production. USER_SERVICE_DB_NAME lets this connect to
// the right database while reusing every other connection param (host/port/user/password/ssl).
function buildUserServiceReadPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.USER_SERVICE_DB_NAME ?? "unblur_user_service",
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });
}

async function main() {
  const writePool = buildDbPool();
  const readPool = buildUserServiceReadPool();
  const repository = new PostgresEmbeddingRepository(writePool);
  const provider = new OpenRouterEmbeddingProvider();

  const { rows } = await readPool.query<{
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
  await readPool.end();
  await writePool.end();
}

main().catch((err) => {
  logger.error({ err }, "backfill failed");
  process.exit(1);
});
