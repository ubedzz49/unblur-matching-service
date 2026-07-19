import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryEmbeddingRepository } from "./embeddings/repository.js";

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
