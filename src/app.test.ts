import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryEmbeddingRepository } from "./embeddings/repository.js";
import { FakeEmbeddingProvider } from "./embeddings/provider.js";

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

// test-only -- lets tests pin exact vectors per input text so similarity scores can be
// controlled precisely, instead of relying on FakeEmbeddingProvider's derived-from-char-codes
// vectors.
class MappedEmbeddingProvider {
  constructor(
    private map: Record<string, number[]>,
    private fallback: number[] = [0, 1],
  ) {}

  async embed(text: string): Promise<number[]> {
    return this.map[text] ?? this.fallback;
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

describe("POST /match/suggest-expertise", () => {
  it("requires a title", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/match/suggest-expertise", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("returns ranked candidates ordered by similarity, highest first", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("dsa-node", "type-cs", "Data Structures", [1, 0]);
    await repo.upsert("algo-node", "type-cs", "Algorithms", [0.9, Math.sqrt(1 - 0.81)]);
    await repo.upsert("anatomy-node", "type-med", "Anatomy", [0, 1]);

    const provider = new MappedEmbeddingProvider({ "stuck on dsa": [1, 0] });
    const app = buildApp(repo, provider as any);

    const res = await app.inject({
      method: "POST",
      url: "/match/suggest-expertise",
      payload: { title: "stuck on dsa" },
    });

    expect(res.statusCode).toBe(200);
    const { suggestions } = res.json();
    expect(suggestions.map((s: any) => s.expertiseLevelId)).toEqual(["dsa-node", "algo-node", "anatomy-node"]);
    expect(suggestions[0].similarity).toBeGreaterThanOrEqual(suggestions[1].similarity);
    expect(suggestions[1].similarity).toBeGreaterThanOrEqual(suggestions[2].similarity);
  });

  it("respects a custom limit", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("a", "type", "A", [1, 0]);
    await repo.upsert("b", "type", "B", [0.9, 0.1]);
    await repo.upsert("c", "type", "C", [0.5, 0.5]);

    const app = buildApp(repo, new FakeEmbeddingProvider());
    const res = await app.inject({
      method: "POST",
      url: "/match/suggest-expertise",
      payload: { title: "topic", limit: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toHaveLength(2);
  });

  it("clamps an out-of-range limit to 1-20", async () => {
    const repo = new InMemoryEmbeddingRepository();
    for (let i = 0; i < 25; i++) {
      await repo.upsert(`node-${i}`, "type", `Label ${i}`, [Math.random(), Math.random()]);
    }

    const app = buildApp(repo, new FakeEmbeddingProvider());
    const res = await app.inject({
      method: "POST",
      url: "/match/suggest-expertise",
      payload: { title: "topic", limit: 999 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions.length).toBeLessThanOrEqual(20);
  });

  it("defaults to 8 when limit is omitted", async () => {
    const repo = new InMemoryEmbeddingRepository();
    for (let i = 0; i < 12; i++) {
      await repo.upsert(`node-${i}`, "type", `Label ${i}`, [Math.random(), Math.random()]);
    }

    const app = buildApp(repo, new FakeEmbeddingProvider());
    const res = await app.inject({ method: "POST", url: "/match/suggest-expertise", payload: { title: "topic" } });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toHaveLength(8);
  });

  it("works with description omitted (title-only)", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("dsa-node", "type-cs", "Data Structures", [1, 0]);

    const provider = new MappedEmbeddingProvider({ "stuck on dsa": [1, 0] });
    const app = buildApp(repo, provider as any);

    const res = await app.inject({
      method: "POST",
      url: "/match/suggest-expertise",
      payload: { title: "stuck on dsa" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions[0].expertiseLevelId).toBe("dsa-node");
  });

  it("returns an empty list gracefully when there are no embedded nodes", async () => {
    const repo = new InMemoryEmbeddingRepository();
    const app = buildApp(repo, new FakeEmbeddingProvider());

    const res = await app.inject({
      method: "POST",
      url: "/match/suggest-expertise",
      payload: { title: "stuck on dsa" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ suggestions: [] });
  });
});
