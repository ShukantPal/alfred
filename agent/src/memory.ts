import Redis from "ioredis";
import * as weave from "weave";

/**
 * Memory layer (Redis). The board's "Redis Iris" + "this layer owns the memory".
 *
 * Two tiers:
 *  - Company context: seeded docs/Slack/projects, keyed for keyword + (optional) vector recall.
 *  - Working memory: rolling per-meeting transcript so the harness has conversational state.
 *
 * For the hackathon this uses Redis as the store and a simple scored keyword match for
 * retrieval. Swap `retrieve` for RediSearch KNN vector search to win the Redis prize harder;
 * the interface stays identical.
 */

export interface ContextDoc {
  id: string;
  source: "gdoc" | "slack" | "project" | "drive";
  title: string;
  owner: string; // who it belongs to — lets us answer "X is on holiday" questions
  text: string;
}

export interface RetrievedChunk {
  doc: ContextDoc;
  score: number;
}

export class Memory {
  private redis: Redis;

  constructor(redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379") {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: () => null,
    });
    // Swallow connection errors; connect() handles fallback explicitly.
    this.redis.on("error", () => {});
  }

  /** Set true when Redis is unreachable; falls back to in-process maps (demo-safe). */
  private fallback = false;
  private memCtx = new Map<string, Record<string, string>>();
  private memCtxIds = new Set<string>();
  private memTurns = new Map<string, string[]>();

  async connect() {
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      await this.redis.ping();
    } catch {
      this.fallback = true;
      console.warn("[memory] Redis unreachable — using in-memory fallback (not for prod).");
    }
  }

  // ---- company context (seeded) ----

  async seedContext(docs: ContextDoc[]) {
    if (this.fallback) {
      for (const d of docs) {
        this.memCtx.set(d.id, { source: d.source, title: d.title, owner: d.owner, text: d.text });
        this.memCtxIds.add(d.id);
      }
      return;
    }
    const pipe = this.redis.pipeline();
    for (const d of docs) {
      pipe.hset(`ctx:${d.id}`, {
        source: d.source,
        title: d.title,
        owner: d.owner,
        text: d.text,
      });
      pipe.sadd("ctx:ids", d.id);
    }
    await pipe.exec();
  }

  /**
   * Retrieve the most relevant context chunks for a query.
   * Hackathon impl: term-overlap scoring. Production: RediSearch FT.SEARCH KNN.
   */
  retrieve = weave.op(async (query: string, k = 4): Promise<RetrievedChunk[]> => {
    const ids = this.fallback ? [...this.memCtxIds] : await this.redis.smembers("ctx:ids");
    const terms = tokenize(query);
    const scored: RetrievedChunk[] = [];
    for (const id of ids) {
      const h = this.fallback ? this.memCtx.get(id) ?? {} : await this.redis.hgetall(`ctx:${id}`);
      if (!h.text) continue;
      const score = overlapScore(terms, tokenize(`${h.title} ${h.text} ${h.owner}`));
      if (score > 0) {
        scored.push({
          doc: {
            id,
            source: h.source as ContextDoc["source"],
            title: h.title,
            owner: h.owner,
            text: h.text,
          },
          score,
        });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  });

  // ---- per-meeting working memory ----

  async appendTurn(meetingId: string, speaker: string, text: string) {
    const entry = JSON.stringify({ speaker, text, ts: Date.now() });
    if (this.fallback) {
      const arr = this.memTurns.get(meetingId) ?? [];
      arr.push(entry);
      this.memTurns.set(meetingId, arr);
      return;
    }
    await this.redis.rpush(`mtg:${meetingId}:turns`, entry);
    await this.redis.expire(`mtg:${meetingId}:turns`, 60 * 60 * 6);
  }

  async recentTurns(meetingId: string, n = 12): Promise<{ speaker: string; text: string }[]> {
    const raw = this.fallback
      ? (this.memTurns.get(meetingId) ?? []).slice(-n)
      : await this.redis.lrange(`mtg:${meetingId}:turns`, -n, -1);
    return raw.map((r) => JSON.parse(r));
  }

  async close() {
    if (this.fallback) return;
    await this.redis.quit();
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function overlapScore(q: string[], doc: string[]): number {
  const set = new Set(doc);
  let hits = 0;
  for (const t of q) if (set.has(t)) hits++;
  return hits;
}
