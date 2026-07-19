export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

// test-only -- deterministic, dependency-free stand-in for the real provider
export class FakeEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    // a tiny deterministic "embedding": stable per input, enough to test similarity
    // ordering without calling a real model
    const dims = 8;
    const vector = new Array(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      vector[i % dims] += text.charCodeAt(i);
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
