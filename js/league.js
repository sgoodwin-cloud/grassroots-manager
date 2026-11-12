// Fixtures, season simulation and the league table.
// The table is always worked out from the stored results, never kept separately.

import { hashSeed, makeRng } from './rng.js';
import { createMatch, stepMinute, matchResult } from './match.js';
import { bestLineup, chooseTactics } from './team.js';
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
 * Who a club can't pick for a round, worked out from its earlier results.
 * A red card means missing the club's next match; an injury means missing as
 * many rounds as it says. round is the round about to be played, counting from 1.
 * Returns a Map of player id -> { reason: 'suspended' | 'injured', rounds } (rounds still to miss, this one included).
 */
export function unavailable(results, clubId, round) {
  const out = new Map();
  for (const r of results) {
    if (!r.incidents || r.round >= round || (r.homeId !== clubId && r.awayId !== clubId)) continue;
    const side = r.homeId === clubId ? 0 : 1;
    for (const e of r.incidents) {
      if (e.side !== side) continue;
      if (e.type === 'red' && r.round === round - 1) out.set(e.playerId, { reason: 'suspended', rounds: 1 });
      if (e.type === 'injury' && r.round + e.out >= round) {
        out.set(e.playerId, { reason: 'injured', rounds: r.round + e.out - round + 1 });
      }
    }
  }
  return out;
}

/**
 * Play one fixture and return the result as it is stored.
 * sideOf(clubId) gives each side's { lineup, tactics?, manager? }. Without
 * tactics, an AI manager chooses them from the two line-ups. roundIndex counts from 0.
 */
export function playFixture(world, season, divisionIndex, roundIndex, fixture, sideOf) {
  return resultOf(runFixture(world, season, divisionIndex, roundIndex, fixture, sideOf), divisionIndex, roundIndex);
}

/** Set a fixture up as a live match state, ready to be stepped a minute at a time. */
export function startFixture(world, season, divisionIndex, roundIndex, fixture, sideOf) {
  const { home, away } = fixture;
  const h = sideOf(home);
  const a = sideOf(away);
  return createMatch({
    home: { clubId: home, name: clubById(world, home).name, lineup: h.lineup, manager: h.manager, tactics: h.tactics || chooseTactics(h.lineup, a.lineup) },
    away: { clubId: away, name: clubById(world, away).name, lineup: a.lineup, manager: a.manager, tactics: a.tactics || chooseTactics(a.lineup, h.lineup) },
    seed: hashSeed(world.seed, season, divisionIndex, roundIndex, home, away),
  });
}

function runFixture(world, season, divisionIndex, roundIndex, fixture, sideOf) {
  const state = startFixture(world, season, divisionIndex, roundIndex, fixture, sideOf);
  while (!state.finished) stepMinute(state);
  return state;
}

/** The stored result of a finished match state. */
export function resultOf(state, divisionIndex, roundIndex) {
  return { divisionIndex, round: roundIndex + 1, ...matchResult(state) };
}

/**
 * Play a full season in every division with AI managers picking the teams,
 * leaving out anyone suspended or injured.
 * Returns { fixtures, results } where each result carries its division and round.
 * There is no development, transfers or promotion between seasons yet.
 */
export function simulateSeason(world, season = 1) {
  const squads = new Map(world.clubs.map((club) => [club.id, squadOf(world, club.id)]));
  const full = new Map(world.clubs.map((club) => [club.id, bestLineup(squads.get(club.id))]));
  const byClub = new Map(world.clubs.map((club) => [club.id, []]));
  const rounds = world.divisions.map((d) => fixturesFor(world, season, d.index));
  const results = [];
  const fixtures = [];
  for (let roundIndex = 0; roundIndex < rounds[0].length; roundIndex++) {
    for (const division of world.divisions) {
      for (const fixture of rounds[division.index][roundIndex]) {
        fixtures.push({ divisionIndex: division.index, round: roundIndex + 1, ...fixture });
        const result = playFixture(world, season, division.index, roundIndex, fixture, (id) => {
          const missing = unavailable(byClub.get(id), id, roundIndex + 1);
          const lineup = missing.size ? bestLineup(squads.get(id).filter((p) => !missing.has(p.id))) : full.get(id);
          return { lineup };
        });
        results.push(result);
        byClub.get(result.homeId).push(result);
        byClub.get(result.awayId).push(result);
      }
    }
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
