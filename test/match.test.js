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
  for (const id of ids) {
    assert.equal(homeCount[id], 11);
    // Nobody plays more than three in a row at home or away.
    const venues = rounds.map((round) => (round.find((f) => f.home === id || f.away === id).home === id ? 'H' : 'A')).join('');
    assert.ok(!/HHHH|AAAA/.test(venues), venues);
  }
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

test('every player gets a stat line and a rating, and the lines add up to the match', () => {
  for (let i = 0; i < 100; i++) {
    const r = simulateMatch({ home: side(clubA), away: side(clubB), seed: `lines-${i}` });
    assert.equal(r.players.length, 2);
    const everyone = r.players.flat();
    assert.equal(everyone.length, 22);
    r.players.forEach((lines, s) => {
      const goals = s === 0 ? r.homeGoals : r.awayGoals;
      const sum = (key) => lines.reduce((t, line) => t + line[key], 0);
      assert.equal(lines.length, 11);
      assert.equal(sum('g'), goals);
      assert.equal(sum('a'), r.goals.filter((g) => g.side === s && g.assistId).length);
      assert.equal(sum('sh'), r.stats[s].shots);
      assert.equal(sum('sot'), r.stats[s].onTarget);
      // Every shot on target the other side had was either a goal or a save.
      const theirGoals = s === 0 ? r.awayGoals : r.homeGoals;
      assert.equal(sum('sv'), r.stats[1 - s].onTarget - theirGoals);
      for (const line of lines) {
        assert.equal(line.min, 90);
        assert.ok(line.rating >= 1 && line.rating <= 10);
        assert.equal(line.rating, Math.round(line.rating * 10) / 10);
        assert.ok(!('delta' in line));
        if (line.role !== 'GK') assert.equal(line.sv, 0);
      }
    });
    const best = Math.max(...everyone.map((line) => line.rating));
    assert.equal(everyone.find((line) => line.id === r.potm).rating, best);
  }
});

test('a goal lifts the scorer and the result moves everyone', () => {
  let scorers = 0, scorerTotal = 0, others = 0, otherTotal = 0;
  for (let i = 0; i < 300; i++) {
    const r = simulateMatch({ home: side(clubA), away: side(clubB), seed: `lift-${i}` });
    for (const line of r.players.flat()) {
      if (line.g > 0) { scorers++; scorerTotal += line.rating; }
      else { others++; otherTotal += line.rating; }
    }
  }
  assert.ok(scorerTotal / scorers > otherTotal / others + 0.7);
});
