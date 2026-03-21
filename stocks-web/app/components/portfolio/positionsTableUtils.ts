import type { Band, Portfolio, Position } from '../../lib/services/portfolioService';

export type PositionSection = {
  bandId: string | null;
  bandLabel: string;
  band: Band | null;
  positions: Position[];
};

export function buildPositionSections(portfolio: Portfolio): PositionSection[] {
  const bands = portfolio.bands ?? [];
  const positions = (portfolio.positions ?? []).filter((p) => (Number(p.quantity) || 0) > 0.0001);
  const sections: PositionSection[] = [];
  for (const band of bands) {
    const bandPositions = positions.filter((p) => p.bandId === band.id);
    if (bandPositions.length > 0) {
      sections.push({
        bandId: band.id,
        bandLabel: band.name || `${band.sizeMinPct}–${band.sizeMaxPct}%`,
        band,
        positions: bandPositions,
      });
    }
  }
  const unassigned = positions.filter((p) => !p.bandId);
  if (unassigned.length > 0) {
    sections.push({ bandId: null, bandLabel: 'No band', band: null, positions: unassigned });
  }
  if (sections.length === 0 && positions.length > 0) {
    sections.push({ bandId: null, bandLabel: 'No band', band: null, positions });
  }
  return sections;
}
