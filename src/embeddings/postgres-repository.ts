import { Pool } from "pg";
import { EmbeddingRepository, RelatedExpertise } from "./repository.js";

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export class PostgresEmbeddingRepository implements EmbeddingRepository {
  constructor(private pool: Pool) {}

  async upsert(expertiseLevelId: string, expertiseTypeId: string, label: string, embedding: number[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO expertise_embeddings (expertise_level_id, expertise_type_id, label, embedding, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (expertise_level_id) DO UPDATE
         SET expertise_type_id = $2, label = $3, embedding = $4, updated_at = now()`,
      [expertiseLevelId, expertiseTypeId, label, toVectorLiteral(embedding)],
    );
  }

  async findRelated(expertiseLevelId: string, limit: number): Promise<RelatedExpertise[]> {
    const result = await this.pool.query<{
      expertise_level_id: string;
      expertise_type_id: string;
      label: string;
      similarity: number;
    }>(
      `SELECT
         e.expertise_level_id,
         e.expertise_type_id,
         e.label,
         1 - (e.embedding <=> target.embedding) AS similarity
       FROM expertise_embeddings e, (SELECT embedding FROM expertise_embeddings WHERE expertise_level_id = $1) AS target
       WHERE e.expertise_level_id != $1
       ORDER BY e.embedding <=> target.embedding
       LIMIT $2`,
      [expertiseLevelId, limit],
    );

    return result.rows.map((r) => ({
      expertiseLevelId: r.expertise_level_id,
      expertiseTypeId: r.expertise_type_id,
      label: r.label,
      similarity: r.similarity,
    }));
  }

  async findNearestByEmbedding(embedding: number[], limit: number): Promise<RelatedExpertise[]> {
    const result = await this.pool.query<{
      expertise_level_id: string;
      expertise_type_id: string;
      label: string;
      similarity: number;
    }>(
      `SELECT
         e.expertise_level_id,
         e.expertise_type_id,
         e.label,
         1 - (e.embedding <=> $1) AS similarity
       FROM expertise_embeddings e
       ORDER BY e.embedding <=> $1
       LIMIT $2`,
      [toVectorLiteral(embedding), limit],
    );

    return result.rows.map((r) => ({
      expertiseLevelId: r.expertise_level_id,
      expertiseTypeId: r.expertise_type_id,
      label: r.label,
      similarity: r.similarity,
    }));
  }
}
