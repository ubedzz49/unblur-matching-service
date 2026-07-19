export interface RelatedExpertise {
  expertiseLevelId: string;
  expertiseTypeId: string;
  label: string;
  similarity: number;
}

export interface EmbeddingRepository {
  upsert(expertiseLevelId: string, expertiseTypeId: string, label: string, embedding: number[]): Promise<void>;
  findRelated(expertiseLevelId: string, limit: number): Promise<RelatedExpertise[]>;
  // Like findRelated, but the query vector is supplied directly instead of looked up by an
  // existing expertise_level_id -- used for matching a freshly-embedded, not-yet-persisted
  // phrase (e.g. an LLM-inferred topic) against the existing taxonomy.
  findNearestByEmbedding(embedding: number[], limit: number): Promise<RelatedExpertise[]>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

// test-only -- avoids CI needing real Postgres + pgvector
export class InMemoryEmbeddingRepository implements EmbeddingRepository {
  private rows = new Map<string, { expertiseTypeId: string; label: string; embedding: number[] }>();

  async upsert(expertiseLevelId: string, expertiseTypeId: string, label: string, embedding: number[]): Promise<void> {
    this.rows.set(expertiseLevelId, { expertiseTypeId, label, embedding });
  }

  async findRelated(expertiseLevelId: string, limit: number): Promise<RelatedExpertise[]> {
    const target = this.rows.get(expertiseLevelId);
    if (!target) return [];

    return Array.from(this.rows.entries())
      .filter(([id]) => id !== expertiseLevelId)
      .map(([id, row]) => ({
        expertiseLevelId: id,
        expertiseTypeId: row.expertiseTypeId,
        label: row.label,
        similarity: cosineSimilarity(target.embedding, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async findNearestByEmbedding(embedding: number[], limit: number): Promise<RelatedExpertise[]> {
    return Array.from(this.rows.entries())
      .map(([id, row]) => ({
        expertiseLevelId: id,
        expertiseTypeId: row.expertiseTypeId,
        label: row.label,
        similarity: cosineSimilarity(embedding, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}
