import { describe, expect, it } from "vitest";
import { InMemoryEmbeddingRepository } from "./repository.js";

describe("InMemoryEmbeddingRepository", () => {
  it("returns the closest vectors first, excluding the queried node itself", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("engineering-maths", "type-maths", "Mathematics — Engineering", [1, 0, 0]);
    await repo.upsert("hs-calculus", "type-maths", "Mathematics — Higher Secondary", [0.9, 0.1, 0]);
    await repo.upsert("anatomy", "type-anatomy", "Anatomy — MBBS", [0, 0, 1]);

    const related = await repo.findRelated("engineering-maths", 5);

    expect(related).toHaveLength(2);
    expect(related[0].expertiseLevelId).toBe("hs-calculus");
    expect(related[0].similarity).toBeGreaterThan(related[1].similarity);
    expect(related.some((r) => r.expertiseLevelId === "engineering-maths")).toBe(false);
  });

  it("respects the limit", async () => {
    const repo = new InMemoryEmbeddingRepository();
    await repo.upsert("a", "type", "A", [1, 0]);
    await repo.upsert("b", "type", "B", [0.9, 0.1]);
    await repo.upsert("c", "type", "C", [0.8, 0.2]);

    expect(await repo.findRelated("a", 1)).toHaveLength(1);
  });

  it("returns an empty list for an unknown node", async () => {
    const repo = new InMemoryEmbeddingRepository();
    expect(await repo.findRelated("nonexistent", 5)).toEqual([]);
  });
});
