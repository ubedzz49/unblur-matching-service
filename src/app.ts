import Fastify, { FastifyInstance } from "fastify";
import { EmbeddingRepository, InMemoryEmbeddingRepository } from "./embeddings/repository.js";
import { EmbeddingProvider, FakeEmbeddingProvider } from "./embeddings/provider.js";
import { ChatProvider, FakeChatProvider } from "./inference/chat-provider.js";

interface RelatedExpertiseQuery {
  levelId?: string;
  limit?: string;
}

interface EmbedNodeBody {
  expertiseLevelId?: string;
  expertiseTypeId?: string;
  label?: string;
}

interface InferExpertiseBody {
  title?: string;
  description?: string;
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// Deliberate, documented threshold for reusing an existing taxonomy node instead of creating a
// new one: high enough that a weak/unrelated match doesn't get silently treated as the same
// subject, low enough that close paraphrases (e.g. "dsa" vs. "Data Structures") still match once
// both are embedded.
const MATCH_THRESHOLD = 0.75;

export function buildApp(
  embeddingRepository: EmbeddingRepository = new InMemoryEmbeddingRepository(),
  embeddingProvider: EmbeddingProvider = new FakeEmbeddingProvider(),
  chatProvider: ChatProvider = new FakeChatProvider(),
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

  app.post<{ Body: InferExpertiseBody }>("/match/infer-expertise", async (request, reply) => {
    const { title, description } = request.body ?? {};
    if (!title) {
      request.log.warn("infer-expertise rejected: missing title");
      return reply.code(400).send({ error: "title is required" });
    }

    let phrase = title;
    try {
      phrase = await chatProvider.inferTopic(title, description);
    } catch (err) {
      // Graceful degradation: an LLM hiccup shouldn't hard-fail the whole request -- fall back
      // to matching on the raw title text instead of the enriched phrase.
      request.log.warn({ err }, "infer-expertise: chat provider failed, falling back to raw title");
      phrase = title;
    }

    let embedding: number[];
    try {
      embedding = await embeddingProvider.embed(phrase);
    } catch (err) {
      request.log.error({ err }, "infer-expertise: embedding call failed");
      return reply.code(502).send({ error: "failed to embed inferred topic" });
    }

    const [top] = await embeddingRepository.findNearestByEmbedding(embedding, 1);

    if (top && top.similarity >= MATCH_THRESHOLD) {
      request.log.info(
        { phrase, expertiseLevelId: top.expertiseLevelId, similarity: top.similarity },
        "infer-expertise matched existing taxonomy node",
      );
      return reply.send({
        matched: true,
        expertiseTypeId: top.expertiseTypeId,
        expertiseLevelId: top.expertiseLevelId,
        label: top.label,
        similarity: top.similarity,
      });
    }

    request.log.info({ phrase }, "infer-expertise found no sufficiently close taxonomy node");
    return reply.send({ matched: false, suggestedLabel: phrase });
  });

  return app;
}
