// Measures how the engine behaves over many simulated seasons. Used by the
// Node calibration tool, the tests and the M1 stats page.

import { hashSeed, makeRng } from './rng.js';
import { generateWorld, squadOf, clubById } from './world.js';
import { simulateSeason, divisionTable } from './league.js';
import { simulateMatch } from './match.js';
import { bestLineup, pickXI, lineupQuality, FORMATIONS } from './team.js';

// Design-doc targets (min, max).
export const TARGETS = {
  goalsPerGame: [2.5, 3.0],
  homeWin: [0.42, 0.48],
  draw: [0.22, 0.28],
};

export const inTarget = (value, [lo, hi]) => value >= lo && value <= hi;

/** Simulate `worldCount` worlds for one season each and total up what happened. */
export function measure(worldCount = 10, seedBase = 'calibration') {
  const out = {
    worlds: worldCount,
    matches: 0,
    goals: 0,
    homeWins: 0,
    draws: 0,
    awayWins: 0,
    shots: 0,
    onTarget: 0,
    goalsHistogram: new Array(9).fill(0), // 0..7 goals in a match, then 8+
    scorelines: {},
    biggestWin: { margin: 0, text: '' },
    championPoints: 0,
    bottomPoints: 0,
    divisions: 0,
    strongestFinishedFirst: 0,
    strongestFinishedTopThree: 0,
    weakestFinishedBottomThree: 0,
    // Matches where one side's eleven is clearly better (1.5+ rating points).
    favourite: { matches: 0, won: 0, drawn: 0, lost: 0 },
  };

  for (let w = 0; w < worldCount; w++) {
    const world = generateWorld(`${seedBase}-${w}`);
    const { results } = simulateSeason(world, 1);
    const quality = new Map(
      world.clubs.map((c) => [c.id, lineupQuality(bestLineup(squadOf(world, c.id)))]),
    );

    for (const r of results) {
      const total = r.homeGoals + r.awayGoals;
      out.matches++;
      out.goals += total;
      out.shots += r.stats[0].shots + r.stats[1].shots;
      out.onTarget += r.stats[0].onTarget + r.stats[1].onTarget;
      out.goalsHistogram[Math.min(total, 8)]++;
      const key = `${r.homeGoals}-${r.awayGoals}`;
      out.scorelines[key] = (out.scorelines[key] || 0) + 1;
      if (r.homeGoals > r.awayGoals) out.homeWins++;
      else if (r.homeGoals < r.awayGoals) out.awayWins++;
      else out.draws++;

      const margin = Math.abs(r.homeGoals - r.awayGoals);
      if (margin > out.biggestWin.margin) {
        out.biggestWin = {
          margin,
          text: `${clubById(world, r.homeId).name} ${r.homeGoals}-${r.awayGoals} ${clubById(world, r.awayId).name}`,
        };
      }

      const gap = quality.get(r.homeId) - quality.get(r.awayId);
      if (Math.abs(gap) >= 1.5) {
        const favGoals = gap > 0 ? r.homeGoals : r.awayGoals;
        const dogGoals = gap > 0 ? r.awayGoals : r.homeGoals;
        out.favourite.matches++;
        if (favGoals > dogGoals) out.favourite.won++;
        else if (favGoals === dogGoals) out.favourite.drawn++;
        else out.favourite.lost++;
      }
    }

    for (const division of world.divisions) {
      const table = divisionTable(world, results, division.index);
      const ranked = division.clubIds.slice().sort((a, b) => quality.get(b) - quality.get(a));
      const place = (id) => table.findIndex((row) => row.clubId === id);
      out.divisions++;
      out.championPoints += table[0].points;
      out.bottomPoints += table[table.length - 1].points;
      if (place(ranked[0]) === 0) out.strongestFinishedFirst++;
      if (place(ranked[0]) <= 2) out.strongestFinishedTopThree++;
      if (place(ranked[ranked.length - 1]) >= table.length - 3) out.weakestFinishedBottomThree++;
    }
  }

  const m = out.matches;
  return {
    ...out,
    goalsPerGame: out.goals / m,
    homeWin: out.homeWins / m,
    draw: out.draws / m,
    awayWin: out.awayWins / m,
    shotsPerTeam: out.shots / (2 * m),
    onTargetPerTeam: out.onTarget / (2 * m),
    goallessDraws: (out.scorelines['0-0'] || 0) / m,
    avgChampionPoints: out.championPoints / out.divisions,
    avgBottomPoints: out.bottomPoints / out.divisions,
  };
}

/**
 * Division gap: a club from one division against a club from the division
 * below, half the matches at each ground. Returns the share the higher side won.
 */
export function measureDivisionGap(matchCount = 3000, seedBase = 'gap') {
  const worlds = [0, 1, 2, 3, 4, 5].map((n) => {
    const world = generateWorld(`${seedBase}-${n}`);
    const lineups = new Map(world.clubs.map((c) => [c.id, bestLineup(squadOf(world, c.id))]));
    return { world, lineups };
  });
  const rng = makeRng(hashSeed(seedBase));
  const gaps = [];
  for (let upper = 0; upper < worlds[0].world.divisions.length - 1; upper++) {
    let won = 0;
    let drawn = 0;
    for (let i = 0; i < matchCount; i++) {
      const { world, lineups } = rng.pick(worlds);
      const hi = rng.pick(world.divisions[upper].clubIds);
      const lo = rng.pick(world.divisions[upper + 1].clubIds);
      const hiHome = i % 2 === 0;
      const side = (id) => ({ clubId: id, name: id, lineup: lineups.get(id) });
      const r = simulateMatch({
        home: side(hiHome ? hi : lo),
        away: side(hiHome ? lo : hi),
        seed: hashSeed(seedBase, upper, i),
      });
      const hiGoals = hiHome ? r.homeGoals : r.awayGoals;
      const loGoals = hiHome ? r.awayGoals : r.homeGoals;
      if (hiGoals > loGoals) won++;
      else if (hiGoals === loGoals) drawn++;
    }
    gaps.push({
      upper: worlds[0].world.divisions[upper].name,
      lower: worlds[0].world.divisions[upper + 1].name,
      won: won / matchCount,
      drawn: drawn / matchCount,
      lost: 1 - (won + drawn) / matchCount,
    });
  }
  return gaps;
}

/**
 * Formation balance: every club plays every other club in its division at
 * home and away using the given formation, against opponents in 4-4-2.
 * Returns points per game for each formation; they should sit close together.
 */
export function measureFormations(worldCount = 3, seedBase = 'formations') {
  const points = Object.fromEntries(Object.keys(FORMATIONS).map((f) => [f, { points: 0, games: 0 }]));
  for (let w = 0; w < worldCount; w++) {
    const world = generateWorld(`${seedBase}-${w}`);
    for (const division of world.divisions) {
      for (const a of division.clubIds) {
        for (const b of division.clubIds) {
          if (a === b) continue;
          const base = pickXI(squadOf(world, b), '4-4-2');
          for (const formation of Object.keys(FORMATIONS)) {
            const mine = pickXI(squadOf(world, a), formation);
            for (const atHome of [true, false]) {
              const me = { clubId: a, name: a, lineup: mine };
              const them = { clubId: b, name: b, lineup: base };
              // The same seed for every formation, so only the shape differs.
              const r = simulateMatch({
                home: atHome ? me : them,
                away: atHome ? them : me,
                seed: hashSeed(seedBase, w, a, b, atHome),
              });
              const mineGoals = atHome ? r.homeGoals : r.awayGoals;
              const theirGoals = atHome ? r.awayGoals : r.homeGoals;
              points[formation].games++;
              points[formation].points += mineGoals > theirGoals ? 3 : mineGoals === theirGoals ? 1 : 0;
            }
          }
        }
      }
    }
  }
  return Object.fromEntries(
    Object.entries(points).map(([f, v]) => [f, v.points / v.games]),
  );
}
