import { describe, expect, it } from "vitest";
import { FakeEmbeddingProvider } from "./provider.js";

describe("FakeEmbeddingProvider", () => {
  it("is deterministic for the same input", async () => {
    const provider = new FakeEmbeddingProvider();
    const a = await provider.embed("Mathematics — Engineering");
    const b = await provider.embed("Mathematics — Engineering");
    expect(a).toEqual(b);
  });

  it("produces different vectors for different input", async () => {
    const provider = new FakeEmbeddingProvider();
    const a = await provider.embed("Mathematics — Engineering");
    const b = await provider.embed("Anatomy — MBBS");
    expect(a).not.toEqual(b);
  });
});
