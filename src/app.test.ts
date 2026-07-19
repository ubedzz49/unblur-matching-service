import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryEmbeddingRepository } from "./embeddings/repository.js";
import { FakeEmbeddingProvider } from "./embeddings/provider.js";
import { ChatProvider, FakeChatProvider } from "./inference/chat-provider.js";

describe("GET /healthz", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /match/related-expertise", () => {
  it("rejects with no levelId", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/match/related-expertise" });
    expect(res.statusCode).toBe(400);
  });

  it("returns related nodes ordered by similarity", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("engineering-maths", "type-maths", "Mathematics — Engineering", [1, 0, 0]);
    await repo.upsert("hs-calculus", "type-maths", "Mathematics — Higher Secondary", [0.9, 0.1, 0]);
    await repo.upsert("anatomy", "type-anatomy", "Anatomy — MBBS", [0, 0, 1]);

    const app = buildApp(repo);
    const res = await app.inject({
      method: "GET",
      url: "/match/related-expertise?levelId=engineering-maths&limit=1",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].expertiseLevelId).toBe("hs-calculus");
  });

  it("clamps an out-of-range limit instead of erroring", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("a", "type", "A", [1, 0]);
    const app = buildApp(repo);

    const res = await app.inject({
      method: "GET",
      url: "/match/related-expertise?levelId=a&limit=999",
    });
    expect(res.statusCode).toBe(200);
  });
});

// test-only -- lets tests pin exact vectors per input text so similarity scores (and the
// 0.75 threshold boundary) can be controlled precisely, instead of relying on
// FakeEmbeddingProvider's derived-from-char-codes vectors.
class MappedEmbeddingProvider {
  constructor(
    private map: Record<string, number[]>,
    private fallback: number[] = [0, 1],
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.map[text] ?? this.fallback;
  }
}

class ThrowingChatProvider implements ChatProvider {
  async inferTopic(): Promise<string> {
    throw new Error("boom");
  }
}

describe("POST /match/embed-node", () => {
  it("rejects when a required field is missing", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/match/embed-node",
      payload: { expertiseTypeId: "type-1", label: "Data Structures" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty body", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/match/embed-node", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("embeds the label and upserts it into the repository", async () => {
    const repo = new InMemoryEmbeddingRepository();
    const provider = new FakeEmbeddingProvider();
    const app = buildApp(repo, provider);

    const res = await app.inject({
      method: "POST",
      url: "/match/embed-node",
      payload: { expertiseLevelId: "dsa-node", expertiseTypeId: "type-cs", label: "Data Structures" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const expectedEmbedding = await provider.embed("Data Structures");
    const [top] = await repo.findNearestByEmbedding(expectedEmbedding, 1);
    expect(top.expertiseLevelId).toBe("dsa-node");
    expect(top.expertiseTypeId).toBe("type-cs");
    expect(top.label).toBe("Data Structures");
    expect(top.similarity).toBeCloseTo(1, 5);
  });
});

describe("POST /match/infer-expertise", () => {
  it("requires a title", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/match/infer-expertise", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns matched: true when the top match is above the threshold", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("dsa-node", "type-cs", "Data Structures", [1, 0]);

    const provider = new MappedEmbeddingProvider({ "Data Structures": [1, 0] });
    const chatProvider = new FakeChatProvider("Data Structures");

    const app = buildApp(repo, provider as any, chatProvider);
    const res = await app.inject({
      method: "POST",
      url: "/match/infer-expertise",
      payload: { title: "stuck on dsa" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(true);
    expect(body.expertiseLevelId).toBe("dsa-node");
    expect(body.expertiseTypeId).toBe("type-cs");
    expect(body.similarity).toBeGreaterThanOrEqual(0.75);
  });

  it("returns matched: false with a suggestedLabel when nothing is close enough", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("anatomy-node", "type-med", "Anatomy", [0, 1]);

    const provider = new MappedEmbeddingProvider({ "Quantum Field Theory": [1, 0] });
    const chatProvider = new FakeChatProvider("Quantum Field Theory");

    const app = buildApp(repo, provider as any, chatProvider);
    const res = await app.inject({
      method: "POST",
      url: "/match/infer-expertise",
      payload: { title: "stuck on gauge bosons" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(false);
    expect(body.suggestedLabel).toBe("Quantum Field Theory");
  });

  it("falls back to the raw title when the chat provider throws", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("dsa-node", "type-cs", "Data Structures", [1, 0]);

    // the fallback path embeds `title` directly -- map exactly that text so we can prove
    // the embedding/matching ran against the raw title rather than any LLM output
    const provider = new MappedEmbeddingProvider({ "stuck on dsa": [1, 0] });
    const chatProvider = new ThrowingChatProvider();

    const app = buildApp(repo, provider as any, chatProvider);
    const res = await app.inject({
      method: "POST",
      url: "/match/infer-expertise",
      payload: { title: "stuck on dsa" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(true);
    expect(body.expertiseLevelId).toBe("dsa-node");
  });

  it("threshold boundary: just above 0.75 matches, just below does not", async () => {
    // vectors chosen so cosine similarity to [1, 0] lands just above/below 0.75
    const aboveVec = [0.77, Math.sqrt(1 - 0.77 * 0.77)]; // similarity ~0.77
    const belowVec = [0.7, Math.sqrt(1 - 0.7 * 0.7)]; // similarity ~0.70

    const repoAbove = new InMemoryEmbeddingRepository();
    await repoAbove.upsert("above-node", "type", "Above", aboveVec);
    const appAbove = buildApp(
      repoAbove,
      new MappedEmbeddingProvider({ topic: [1, 0] }) as any,
      new FakeChatProvider("topic"),
    );
    const resAbove = await appAbove.inject({
      method: "POST",
      url: "/match/infer-expertise",
      payload: { title: "topic" },
    });
    expect(resAbove.json().matched).toBe(true);

    const repoBelow = new InMemoryEmbeddingRepository();
    await repoBelow.upsert("below-node", "type", "Below", belowVec);
    const appBelow = buildApp(
      repoBelow,
      new MappedEmbeddingProvider({ topic: [1, 0] }) as any,
      new FakeChatProvider("topic"),
    );
    const resBelow = await appBelow.inject({
      method: "POST",
      url: "/match/infer-expertise",
      payload: { title: "topic" },
    });
    expect(resBelow.json().matched).toBe(false);
  });
});
