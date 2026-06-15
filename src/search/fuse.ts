// ============================================================================
// src/search/fuse.ts — Reciprocal Rank Fusion (RRF).
//
// arra-oracle blends results with a hand-tuned linear formula
// (fts*0.7 + vec*0.65 + 0.12*overlap) that mixes BM25 magnitudes with cosine
// distances — two scales that are not comparable, so the weights are fragile and
// corpus-dependent. RRF sidesteps the whole problem: it fuses on RANK, not score,
// so a document's contribution depends only on where it placed in each list, not
// on the (incomparable) raw numbers. A doc that ranks well in two lists naturally
// sums two reciprocals and outranks a doc strong in only one. k=60 is the
// standard Cormack et al. constant. Pure, deterministic, parameter-light.
// ============================================================================

export interface RankedList {
  /** doc ids in descending relevance (best first). */
  ids: string[];
  /** optional per-list weight (default 1). Lets a memory-prior list nudge without dominating. */
  weight?: number;
}

const RRF_K = 60;

/**
 * Fuse N ranked id-lists into a single score map (higher = better).
 * score(d) = Σ_lists weight / (k + rank_in_list(d)), rank 0-based.
 */
export function rrf(lists: RankedList[], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const w = list.weight ?? 1;
    for (let rank = 0; rank < list.ids.length; rank++) {
      const id = list.ids[rank];
      scores.set(id, (scores.get(id) ?? 0) + w / (k + rank));
    }
  }
  return scores;
}

/** RRF then sort → fused id list (best first), deterministic tie-break by id. */
export function rrfFuse(lists: RankedList[], limit?: number, k: number = RRF_K): string[] {
  const scores = rrf(lists, k);
  const out = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const ids = out.map(([id]) => id);
  return limit == null ? ids : ids.slice(0, limit);
}
