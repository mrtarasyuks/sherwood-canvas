// Weekly seasons — pure scoring over the contract's Painted events. No network access here, so anyone can re-run it
// (and scripts/test-season.mjs does) and get the same table the site shows.
//
// Rules: a week runs Monday 00:00 UTC → next Monday. Paint a free pixel +1, take someone else's pixel +3, and every
// pixel you hold when the week ends +1 (for the running week: what you hold right now). The prize pool of a week is
// the treasury's share of that week's paints; it goes 50/30/20 to the top three. Wallets in `exclude` (the builder)
// still play but never rank.

export const WEEK = 7 * 86400;
export const SEASON1_START = 1790553600; // Mon 28 Sep 2026 00:00 UTC
export const POINTS = { free: 1, steal: 3, hold: 1 };
export const SPLIT = [50n, 30n, 20n]; // % of the pool for places 1–3

export const seasonOf = (ts) => Math.max(1, Math.floor((ts - SEASON1_START) / WEEK) + 1);
export const seasonStart = (n) => SEASON1_START + (n - 1) * WEEK;

/**
 * @param events  Painted events in chain order: { id: number, painter: string, prev: string|null, price: bigint, season: number }
 *                (addresses lower-cased, prev = null for a free pixel)
 * @param current the running season
 * @param exclude lower-cased addresses that never rank
 * @returns Map season → { n, pool, paints, rows: Map addr → { addr, free, steal, held, points }, ranked: row[] }
 */
export function score(events, current, exclude = new Set()) {
  const owner = new Map(); // pixel id → holder
  const seasons = new Map();
  const S = (n) => {
    if (!seasons.has(n)) seasons.set(n, { n, pool: 0n, paints: 0, rows: new Map(), ranked: [] });
    return seasons.get(n);
  };
  const row = (s, a) => {
    if (!s.rows.has(a)) s.rows.set(a, { addr: a, free: 0, steal: 0, held: 0, points: 0 });
    return s.rows.get(a);
  };
  const snapshot = (n) => { const s = S(n); for (const a of owner.values()) row(s, a).held++; };

  let cur = 1;
  for (const e of events) {
    while (cur < e.season) snapshot(cur++); // week(s) closed before this paint: freeze who held what
    const s = S(e.season);
    s.paints++;
    if (!e.prev) {
      s.pool += e.price;
      row(s, e.painter).free++;
    } else {
      s.pool += e.price - e.price / 2n;
      if (e.prev !== e.painter) row(s, e.painter).steal++; // repainting your own pixel scores nothing
    }
    owner.set(e.id, e.painter);
  }
  while (cur < current) snapshot(cur++);
  snapshot(current);

  for (const s of seasons.values()) {
    for (const r of s.rows.values()) r.points = r.free * POINTS.free + r.steal * POINTS.steal + r.held * POINTS.hold;
    s.ranked = [...s.rows.values()]
      .filter((r) => r.points > 0 && !exclude.has(r.addr))
      .sort((a, b) => b.points - a.points || b.steal - a.steal || (a.addr < b.addr ? -1 : 1));
  }
  return seasons;
}

/** prize for place i (0-based) of a season */
export const prize = (season, i) => (i < SPLIT.length ? (season.pool * SPLIT[i]) / 100n : 0n);
