// Fixtures, season simulation and the league table.
// The table is always worked out from the stored results, never kept separately.

import { hashSeed, makeRng } from './rng.js';
import { simulateMatch } from './match.js';
import { bestLineup } from './team.js';
import { squadOf, clubById } from './world.js';

/**
 * Home-and-away fixtures for an even number of clubs (the circle method).
 * Returns rounds: an array of rounds, each an array of { home, away }.
 * Every pair meets twice, once at each ground, and every club plays once a round.
 */
export function roundRobin(clubIds, rng) {
  const ids = rng ? rng.shuffle(clubIds) : clubIds.slice();
  const n = ids.length;
  if (n % 2 !== 0) throw new Error('roundRobin needs an even number of clubs');

  const firstHalf = [];
  const ring = ids.slice(1);
  for (let round = 0; round < n - 1; round++) {
    const order = [ids[0], ...ring];
    const fixtures = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      // Alternate venues so nobody gets a long run at home or away: the fixed
      // club alternates by round, the other pairings by their place in the ring.
      const flip = i === 0 ? round % 2 === 1 : i % 2 === 1;
      fixtures.push(flip ? { home: b, away: a } : { home: a, away: b });
    }
    firstHalf.push(fixtures);
    ring.unshift(ring.pop());
  }
  const secondHalf = firstHalf.map((fixtures) =>
    fixtures.map(({ home, away }) => ({ home: away, away: home })),
  );
  return [...firstHalf, ...secondHalf];
}

/** League table from a list of results, sorted: points, goal difference, goals for, name. */
export function tableFromResults(clubIds, results, nameOf = (id) => id) {
  const rows = new Map(
    clubIds.map((id) => [
      id,
      { clubId: id, name: nameOf(id), played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 },
    ]),
  );
  for (const r of results) {
    const home = rows.get(r.homeId);
    const away = rows.get(r.awayId);
    if (!home || !away) continue;
    home.played++;
    away.played++;
    home.gf += r.homeGoals;
    home.ga += r.awayGoals;
    away.gf += r.awayGoals;
    away.ga += r.homeGoals;
    if (r.homeGoals > r.awayGoals) {
      home.won++;
      away.lost++;
      home.points += 3;
    } else if (r.homeGoals < r.awayGoals) {
      away.won++;
      home.lost++;
      away.points += 3;
    } else {
      home.drawn++;
      away.drawn++;
      home.points++;
      away.points++;
    }
  }
  const table = [...rows.values()];
  for (const row of table) row.gd = row.gf - row.ga;
  table.sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.name.localeCompare(b.name),
  );
  return table;
}

/** The 22 rounds of fixtures for one division in one season. Worked out from the seed, never stored. */
export function fixturesFor(world, season, divisionIndex) {
  const rng = makeRng(hashSeed('fixtures', world.seed, season, divisionIndex));
  return roundRobin(world.divisions[divisionIndex].clubIds, rng);
}

/**
 * Play one fixture and return the result as it is stored.
 * lineupOf(clubId) gives each side's line-up. roundIndex counts from 0.
 */
export function playFixture(world, season, divisionIndex, roundIndex, fixture, lineupOf) {
  const { home, away } = fixture;
  const result = simulateMatch({
    home: { clubId: home, name: clubById(world, home).name, lineup: lineupOf(home) },
    away: { clubId: away, name: clubById(world, away).name, lineup: lineupOf(away) },
    seed: hashSeed(world.seed, season, divisionIndex, roundIndex, home, away),
  });
  return {
    divisionIndex,
    round: roundIndex + 1,
    homeId: result.homeId,
    awayId: result.awayId,
    homeGoals: result.homeGoals,
    awayGoals: result.awayGoals,
    goals: result.goals,
    stats: result.stats,
    players: result.players,
    potm: result.potm,
  };
}

/**
 * Play a full season in every division with AI managers picking the teams.
 * Returns { fixtures, results } where each result carries its division and round.
 * There is no development, transfers or promotion between seasons yet.
 */
export function simulateSeason(world, season = 1) {
  const lineups = new Map(
    world.clubs.map((club) => [club.id, bestLineup(squadOf(world, club.id))]),
  );
  const results = [];
  const fixtures = [];
  for (const division of world.divisions) {
    fixturesFor(world, season, division.index).forEach((round, roundIndex) => {
      for (const fixture of round) {
        fixtures.push({ divisionIndex: division.index, round: roundIndex + 1, ...fixture });
        results.push(
          playFixture(world, season, division.index, roundIndex, fixture, (id) => lineups.get(id)),
        );
      }
    });
  }
  return { fixtures, results };
}

export function divisionTable(world, results, divisionIndex) {
  const division = world.divisions[divisionIndex];
  return tableFromResults(
    division.clubIds,
    results.filter((r) => r.divisionIndex === divisionIndex),
    (id) => clubById(world, id).name,
  );
}
