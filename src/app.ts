import Fastify, { FastifyInstance } from "fastify";
import { EmbeddingRepository, InMemoryEmbeddingRepository } from "./embeddings/repository.js";

interface RelatedExpertiseQuery {
  levelId?: string;
  limit?: string;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export function buildApp(
  embeddingRepository: EmbeddingRepository = new InMemoryEmbeddingRepository(),
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" },
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get<{ Querystring: RelatedExpertiseQuery }>("/match/related-expertise", async (request, reply) => {
    const { levelId } = request.query;
    if (!levelId) {
      request.log.warn("related-expertise rejected: missing levelId");
      return reply.code(400).send({ error: "levelId is required" });
    }

    const requestedLimit = Number(request.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;

    const related = await embeddingRepository.findRelated(levelId, limit);
    request.log.info({ levelId, resultCount: related.length }, "related expertise looked up");
    return reply.send(related);
  });

  return app;
}
