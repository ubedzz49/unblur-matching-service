import Fastify, { FastifyInstance } from "fastify";
import { EmbeddingRepository, InMemoryEmbeddingRepository } from "./embeddings/repository.js";
import { EmbeddingProvider, FakeEmbeddingProvider } from "./embeddings/provider.js";

interface RelatedExpertiseQuery {
  levelId?: string;
  limit?: string;
}

interface EmbedNodeBody {
  expertiseLevelId?: string;
  expertiseTypeId?: string;
  label?: string;
}

interface SuggestExpertiseBody {
  title?: string;
  description?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const SUGGEST_DEFAULT_LIMIT = 8;
const SUGGEST_MAX_LIMIT = 20;

export function buildApp(
  embeddingRepository: EmbeddingRepository = new InMemoryEmbeddingRepository(),
  embeddingProvider: EmbeddingProvider = new FakeEmbeddingProvider(),
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

  // Called service-to-service by user-service once it creates a new user-submitted taxonomy
  // node (e.g. "DSA"), so that the new node participates in matching immediately instead of
  // waiting for the next batch backfill run. No end-user auth needed here, same as
  // /match/related-expertise above.
  app.post<{ Body: EmbedNodeBody }>("/match/embed-node", async (request, reply) => {
    const { expertiseLevelId, expertiseTypeId, label } = request.body ?? {};
    if (!expertiseLevelId || !expertiseTypeId || !label) {
      request.log.warn("embed-node rejected: missing required field(s)");
      return reply.code(400).send({ error: "expertiseLevelId, expertiseTypeId and label are all required" });
    }

    const embedding = await embeddingProvider.embed(label);
    await embeddingRepository.upsert(expertiseLevelId, expertiseTypeId, label, embedding);

    request.log.info({ expertiseLevelId, expertiseTypeId }, "embedded taxonomy node");
    return reply.send({ ok: true });
  });

  // Called by the frontend (through the gateway, which handles JWT verification -- no auth
  // needed here) while a user is typing a new doubt's title/description, so they can pick
  // from a ranked list of existing subjects instead of the service auto-detecting one for
  // them. Pure embedding similarity -- no LLM chat call involved.
  app.post<{ Body: SuggestExpertiseBody }>("/match/suggest-expertise", async (request, reply) => {
    const { title, description, limit: requestedLimit } = request.body ?? {};
    if (!title) {
      request.log.warn("suggest-expertise rejected: missing title");
      return reply.code(400).send({ error: "title is required" });
    }

    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Number(requestedLimit), 1), SUGGEST_MAX_LIMIT)
      : SUGGEST_DEFAULT_LIMIT;

    const input = `${title} ${description ?? ""}`.trim();
    const embedding = await embeddingProvider.embed(input);
    const suggestions = await embeddingRepository.findNearestByEmbedding(embedding, limit);

    request.log.info({ resultCount: suggestions.length }, "suggest-expertise looked up");
    return reply.send({ suggestions });
  });

  return app;
}
