// Scoring tests for docs/season.js. Run: node scripts/test-season.mjs
import { score, seasonOf, seasonStart, SEASON1_START, WEEK, HOLDER_BONUS, holdersByWeek } from "../docs/season.js";

let pass = 0, fail = 0;
const check = (name, ok, info = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); };
const B = 10n ** 13n;
const [A, Bo, C, K] = ["0xaa", "0xbb", "0xcc", "0xkeeper"];
const ev = (season, id, painter, prev, price) => ({ season, id, painter, prev, price });

check("season 1 starts Mon 28 Sep 2026 00:00 UTC", new Date(SEASON1_START * 1000).toISOString() === "2026-09-28T00:00:00.000Z");
check("seasonOf start = 1", seasonOf(SEASON1_START) === 1);
check("seasonOf last second of week 1 = 1", seasonOf(SEASON1_START + WEEK - 1) === 1);
check("seasonOf next Monday = 2", seasonOf(SEASON1_START + WEEK) === 2);
check("seasonStart(3)", seasonStart(3) === SEASON1_START + 2 * WEEK);

const events = [
  ev(1, 0, A, null, B),        // A free
  ev(1, 1, A, null, B),        // A free
  ev(1, 2, Bo, null, B),       // Bo free
  ev(1, 0, Bo, A, B),          // Bo steals 0 from A
  ev(1, 2, Bo, Bo, 2n * B),    // Bo repaints own pixel → 0 pts
  ev(1, 5, K, null, B),        // keeper free
  // week 2
  ev(2, 1, C, A, B),           // C steals 1 from A
  ev(2, 7, C, null, B),        // C free
];
const s = score(events, 2, new Set([K]));
const s1 = s.get(1), s2 = s.get(2);
const r = (season, a) => season.rows.get(a) ?? { points: 0, held: 0, free: 0, steal: 0 };

// week 1 closes with: 0→Bo, 1→A, 2→Bo, 5→K
check("w1 A: 2 free + holds 1 = 3", r(s1, A).points === 3, JSON.stringify(r(s1, A)));
check("w1 Bo: 1 free + 1 steal + holds 2 = 6", r(s1, Bo).points === 6, JSON.stringify(r(s1, Bo)));
check("w1 own-pixel repaint scores nothing", r(s1, Bo).steal === 1);
check("w1 keeper scored but not ranked", r(s1, K).points === 2 && !s1.ranked.some((x) => x.addr === K));
check("w1 ranking Bo, A", s1.ranked.map((x) => x.addr).join() === [Bo, A].join());
// pool: free 4×B (A,A,Bo,K) + steal B−B/2 + own repaint 2B−B = 4B + B/2 + B
check("w1 pool = treasury share", s1.pool === 4n * B + B / 2n + B, String(s1.pool));
check("w1 paints counted", s1.paints === 6);

// week 2 live: 0→Bo, 1→C, 2→Bo, 5→K, 7→C
check("w2 C: 1 steal + 1 free + holds 2 = 6", r(s2, C).points === 6, JSON.stringify(r(s2, C)));
check("w2 Bo: only holdings = 2", r(s2, Bo).points === 2);
check("w2 A: lost everything = 0, unranked", r(s2, A).points === 0 && !s2.ranked.some((x) => x.addr === A));
check("w2 ranking C, Bo", s2.ranked.map((x) => x.addr).join() === [C, Bo].join());

// quiet weeks still snapshot holders
const s4 = score(events, 4, new Set([K]));
check("quiet week 3 still counts holdings", r(s4.get(3), C).held === 2 && r(s4.get(3), Bo).held === 2);
check("running week 4 has live holdings", r(s4.get(4), C).points === 2);
check("quiet week pool = 0", s4.get(3).pool === 0n);

// $SHRWD holders: ×2, per season
const h = score(events, 2, new Set([K]), new Map([[2, new Set([Bo])]]));
check("holder bonus is ×2", HOLDER_BONUS === 2);
check("w2 holder Bo doubled 2 → 4", r(h.get(2), Bo).base === 2 && r(h.get(2), Bo).points === 4 && r(h.get(2), Bo).holder);
check("w2 non-holder C unchanged", r(h.get(2), C).points === 6 && !r(h.get(2), C).holder);
check("w1 has no holder set → no bonus", r(h.get(1), Bo).points === 6 && !r(h.get(1), Bo).holder);
const h2 = score(events, 2, new Set([K]), new Map([[2, new Set([Bo, K])]]));
check("bonus can flip the ranking", h.get(2).ranked.map((x) => x.addr).join() === [C, Bo].join() && score([ev(1, 0, A, null, B), ev(1, 1, A, null, B), ev(1, 2, A, null, B), ev(1, 3, C, null, B), ev(1, 4, C, null, B)], 1, new Set(), new Map([[1, new Set([C])]])).get(1).ranked[0].addr === C); // A 3+3=6 vs C (2+2)×2=8
check("holder keeper still never ranks", !h2.get(2).ranked.some((x) => x.addr === K));

// holders rebuilt from Transfer events
const Z = "0x" + "0".repeat(40), CURVE = "0xcurve";
const tx = (block, from, to, value) => ({ block: BigInt(block), from, to, value });
const hw = holdersByWeek(
  [tx(10, Z, CURVE, 1000n), tx(11, CURVE, A, 5n), tx(20, CURVE, Bo, 3n), tx(25, A, CURVE, 5n), tx(31, CURVE, C, 1n)],
  [{ n: 1, end: 20n }, { n: 2, end: 30n }, { n: 3, end: null }],
);
const names = (n) => [...hw.get(n)].filter((a) => a !== CURVE).sort().join();
check("week 1 holders: A", names(1) === A, names(1));
check("week 2: A sold out, Bo bought", names(2) === Bo, names(2));
check("running week includes the latest buy", names(3) === [Bo, C].sort().join(), names(3));
check("zero address never a holder", ![...hw.get(3)].includes(Z));

// tie-break: steals first
const t = score([ev(1, 0, A, null, B), ev(1, 1, A, null, B), ev(1, 2, A, null, B), ev(1, 3, C, null, B), ev(1, 3, Bo, C, B)], 1).get(1);
// A: 3 free + 3 held = 6; Bo: 1 steal (3) + 1 held = 4; C: 1 free + 0 held = 1
check("ranking by points", t.ranked.map((x) => x.addr).join() === [A, Bo, C].join());
const t2 = score([ev(1, 0, A, null, B), ev(1, 1, A, null, B), ev(1, 2, C, null, B), ev(1, 2, Bo, C, B)], 1).get(1);
// A: 2 free + 2 held = 4; Bo: steal 3 + held 1 = 4 → Bo wins the tie on steals
check("tie broken by steals", t2.ranked[0].addr === Bo, t2.ranked.map((x) => `${x.addr}:${x.points}`).join());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
