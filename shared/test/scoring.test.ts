import { describe, expect, it } from 'vitest';
import { AwardStats, MATCH, PaintGrid, computeAwards, evaluateHill, scoreLimitReached, winningTeam } from '../src';

const bounds = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
function flatGrid(): PaintGrid {
  const g = new PaintGrid(bounds, 1);
  g.scan(() => ({ y: 0, nx: 0, ny: 1, nz: 0 }));
  return g;
}

describe('PaintGrid', () => {
  it('counts painted cells per team and converts on overpaint', () => {
    const g = flatGrid();
    const changed = g.brush(5, 0, 5, 1.5, 0);
    expect(changed.length).toBeGreaterThan(0);
    expect(g.counts[0]).toBe(changed.length);
    g.brush(5, 0, 5, 1.5, 1);
    expect(g.counts[0]).toBe(0);
    expect(g.counts[1]).toBe(changed.length);
  });
  it('reports no change when the same team paints the same spot', () => {
    const g = flatGrid();
    g.brush(5, 0, 5, 1.5, 0);
    expect(g.brush(5, 0, 5, 1.5, 0)).toEqual([]);
  });
  it('ignores cells without a surface and off-map brushes', () => {
    const g = new PaintGrid(bounds, 1);
    g.scan((x) => (x < 5 ? { y: 0, nx: 0, ny: 1, nz: 0 } : null));
    expect(g.paintable).toBe(50);
    g.brush(8, 0, 5, 1.5, 0);
    expect(g.counts[0]).toBe(0);
    expect(g.brush(-50, 0, -50, 2, 0)).toEqual([]);
  });
  it('does not paint a floor far below the hit point', () => {
    const g = flatGrid();
    expect(g.brush(5, 30, 5, 1.5, 0)).toEqual([]);
  });
  it('computes percent of paintable area and clears', () => {
    const g = flatGrid();
    for (let i = 0; i < 25; i++) g.set(i, 1);
    expect(g.percent(1)).toBe(25);
    g.clear();
    expect(g.percent(1)).toBe(0);
  });
});

describe('king of the hill', () => {
  it('nobody → no owner', () => expect(evaluateHill([])).toEqual({ owner: -1, contested: false }));
  it('single team holds', () => expect(evaluateHill([1, 1])).toEqual({ owner: 1, contested: false }));
  it('two teams contest', () => expect(evaluateHill([0, 1])).toEqual({ owner: -1, contested: true }));
});

describe('match end', () => {
  it('uses the limit of each mode', () => {
    const base = { scoreA: 0, scoreB: 0, bestPlayerScore: 0 };
    expect(scoreLimitReached({ ...base, mode: 'ffa', bestPlayerScore: MATCH.ffaKillLimit })).toBe(true);
    expect(scoreLimitReached({ ...base, mode: 'tdm', scoreB: MATCH.tdmKillLimit })).toBe(true);
    expect(scoreLimitReached({ ...base, mode: 'koth', scoreA: MATCH.kothScoreLimit - 1 })).toBe(false);
    expect(scoreLimitReached({ ...base, mode: 'paint', scoreA: 99999 })).toBe(false);
  });
  it('winning team and draw', () => {
    expect(winningTeam(3, 1)).toBe(0);
    expect(winningTeam(1, 3)).toBe(1);
    expect(winningTeam(2, 2)).toBe(-1);
  });
});

describe('awards', () => {
  const blank = (nick: string): AwardStats => ({ nick, airTicks: 0, launches: 0, plungerHits: 0, bubbleHits: 0, toastHits: 0, chickenKills: 0, falls: 0, paintCells: 0, hillTicks: 0, damageTaken: 0, bestStreak: 0 });
  it('gives the plunger crown to the top plunger user', () => {
    const awards = computeAwards([{ ...blank('A'), plungerHits: 1 }, { ...blank('B'), plungerHits: 5 }]);
    expect(awards.find((a) => a.title === 'Король вантуза')?.nick).toBe('B');
  });
  it('skips awards below their threshold', () => {
    expect(computeAwards([{ ...blank('A'), airTicks: 10 }])).toEqual([]);
  });
  it('spreads awards across players before doubling up', () => {
    const awards = computeAwards(
      [
        { ...blank('A'), plungerHits: 5, falls: 3 },
        { ...blank('B'), bubbleHits: 1 },
      ],
      2,
    );
    expect(new Set(awards.map((a) => a.nick)).size).toBe(2);
  });
});
