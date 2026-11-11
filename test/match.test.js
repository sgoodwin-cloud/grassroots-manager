import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld, squadOf } from '../js/world.js';
import { FORMATIONS, pickXI, bestLineup, teamStrength } from '../js/team.js';
import { createMatch, stepMinute, simulateMatch, matchResult, MATCH_MINUTES } from '../js/match.js';
import { roundRobin, tableFromResults, simulateSeason, divisionTable } from '../js/league.js';

const world = generateWorld('match-tests');
const side = (club) => ({ clubId: club.id, name: club.name, lineup: bestLineup(squadOf(world, club.id)) });
const [clubA, clubB] = world.clubs.filter((c) => c.divisionIndex === 3);

test('every formation gives eleven players: one keeper and the right shape', () => {
  const squad = squadOf(world, clubA.id);
  for (const [name, shape] of Object.entries(FORMATIONS)) {
    const lineup = pickXI(squad, name);
    assert.equal(lineup.players.length, 11);
    assert.equal(lineup.bench.length, 11);
    assert.equal(new Set(lineup.players.map((x) => x.player.id)).size, 11);
    assert.equal(lineup.players.filter((x) => x.role === 'GK').length, 1);
    assert.equal(lineup.players[0].player.pos, 'GK');
    for (const role of ['DEF', 'MID', 'ATT']) {
      assert.equal(lineup.players.filter((x) => x.role === role).length, shape[role]);
    }
    const strength = teamStrength(lineup);
    for (const key of ['gk', 'def', 'mid', 'att']) assert.ok(strength[key] > 0);
  }
});

test('a match replays exactly from its seed', () => {
  const setup = { home: side(clubA), away: side(clubB), seed: 'replay' };
  assert.deepEqual(simulateMatch(setup), simulateMatch(setup));
  const other = simulateMatch({ ...setup, seed: 'different' });
  assert.notDeepEqual(other.events, simulateMatch(setup).events);
});

test('stepping a minute at a time gives the same match as running it in one go', () => {
  const setup = { home: side(clubA), away: side(clubB), seed: 'stepped' };
  const whole = simulateMatch(setup);
  const state = createMatch(setup);
  let steps = 0;
  while (!state.finished) {
    stepMinute(state);
    steps++;
    // Pausing means saving and reloading the state mid-match.
    if (steps === 45) Object.assign(state, JSON.parse(JSON.stringify(state)));
  }
  assert.equal(steps, MATCH_MINUTES);
  assert.equal(stepMinute(state).length, 0);
  const result = matchResult(state);
  assert.equal(result.homeGoals, whole.homeGoals);
  assert.equal(result.awayGoals, whole.awayGoals);
  assert.deepEqual(state.events, whole.events);
});

test('the score always matches the goals in the event list', () => {
  for (let i = 0; i < 200; i++) {
    const r = simulateMatch({ home: side(clubA), away: side(clubB), seed: `sum-${i}` });
    assert.equal(r.goals.filter((g) => g.side === 0).length, r.homeGoals);
    assert.equal(r.goals.filter((g) => g.side === 1).length, r.awayGoals);
    for (const e of r.events) {
      assert.ok(e.minute >= 1 && e.minute <= 90);
      assert.ok(['goal', 'save', 'miss'].includes(e.type));
      if (e.assistId) assert.notEqual(e.assistId, e.playerId);
    }
    assert.equal(r.stats[0].possession + r.stats[1].possession, 100);
    assert.ok(r.stats[0].onTarget <= r.stats[0].shots);
  }
});

test('fixtures: 22 rounds, everyone plays once a round, each pair meets home and away', () => {
  const ids = world.divisions[0].clubIds;
  const rounds = roundRobin(ids);
  assert.equal(rounds.length, 22);
  const pairs = new Set();
  const homeCount = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const round of rounds) {
    assert.equal(round.length, 6);
    assert.equal(new Set(round.flatMap((f) => [f.home, f.away])).size, 12);
    for (const f of round) {
      pairs.add(`${f.home}>${f.away}`);
      homeCount[f.home]++;
    }
  }
  assert.equal(pairs.size, 12 * 11);
  for (const id of ids) assert.equal(homeCount[id], 11);
});

test('the table is worked out from results and adds up', () => {
  const table = tableFromResults(
    ['a', 'b', 'c'],
    [
      { homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0 },
      { homeId: 'b', awayId: 'c', homeGoals: 1, awayGoals: 1 },
      { homeId: 'c', awayId: 'a', homeGoals: 0, awayGoals: 1 },
    ],
  );
  assert.deepEqual(table.map((r) => r.clubId), ['a', 'c', 'b']);
  assert.deepEqual(
    { ...table[0], name: undefined },
    { clubId: 'a', name: undefined, played: 2, won: 2, drawn: 0, lost: 0, gf: 3, ga: 0, gd: 3, points: 6 },
  );
  // c and b both have one point; c is ahead on goal difference.
  assert.equal(table[1].gd, -1);
  assert.equal(table[2].gd, -2);
});

test('a simulated season is complete and repeatable', () => {
  const season = simulateSeason(world, 1);
  assert.equal(season.results.length, 4 * 22 * 6);
  assert.deepEqual(season.results, simulateSeason(world, 1).results);
  assert.notDeepEqual(season.results, simulateSeason(world, 2).results);
  for (const division of world.divisions) {
    const table = divisionTable(world, season.results, division.index);
    assert.equal(table.length, 12);
    for (const row of table) {
      assert.equal(row.played, 22);
      assert.equal(row.won + row.drawn + row.lost, 22);
      assert.equal(row.points, row.won * 3 + row.drawn);
    }
    const sum = (key) => table.reduce((total, row) => total + row[key], 0);
    assert.equal(sum('gf'), sum('ga'));
    assert.equal(sum('won'), sum('lost'));
    for (let i = 1; i < table.length; i++) assert.ok(table[i - 1].points >= table[i].points);
  }
});
