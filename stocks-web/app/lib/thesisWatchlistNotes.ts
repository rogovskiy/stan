/**
 * Watchlist `notes` for a transcript thesis row: matches the thesis headline + body
 * shown next to "Add to watchlist" (ticker is stored separately on the item).
 */
export function formatThesisCardNotesForWatchlist(title: string, summary: string): string {
  const t = title.trim();
  const s = summary.trim();
  if (t && s) return `${t}\n${s}`;
  return t || s;
}

/** Join multiple thesis blocks for the same ticker (e.g. auto-link). */
export function joinThesisNoteBlocks(blocks: string[]): string {
  return blocks.map((b) => b.trim()).filter(Boolean).join('\n\n---\n\n');
}
