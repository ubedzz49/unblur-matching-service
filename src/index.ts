import { buildApp } from "./app.js";
import { buildDbPool } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";
import { PostgresEmbeddingRepository } from "./embeddings/postgres-repository.js";
import { OpenRouterEmbeddingProvider } from "./embeddings/openrouter-provider.js";
import { OpenRouterChatProvider } from "./inference/chat-provider.js";
import { logger } from "./logger.js";

const port = Number(process.env.PORT ?? 3001);
const dbPool = buildDbPool();

runMigrations(dbPool)
  .then(() => {
    const app = buildApp(
      new PostgresEmbeddingRepository(dbPool),
      new OpenRouterEmbeddingProvider(),
      new OpenRouterChatProvider(),
    );
    return app.listen({ port, host: "0.0.0.0" }).then(() => app.log.info({ port }, "matching-service listening"));
  })
  .catch((err) => {
    logger.error({ err }, "matching-service failed to start");
    process.exit(1);
  });
