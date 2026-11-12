import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld, squadOf } from '../js/world.js';
import { FORMATIONS, pickXI, bestLineup, teamStrength } from '../js/team.js';
import {
  createMatch, stepMinute, simulateMatch, matchResult, substitute, setTactics, replaceInjured, bestReplacement,
  currentRate, MATCH_MINUTES, MAX_SUBS,
} from '../js/match.js';
import { roundRobin, tableFromResults, simulateSeason, divisionTable, unavailable } from '../js/league.js';

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
      assert.ok(['goal', 'save', 'miss', 'yellow', 'red', 'injury', 'sub'].includes(e.type));
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
    r.players.forEach((lines, s) => {
      const goals = s === 0 ? r.homeGoals : r.awayGoals;
      const sum = (key) => lines.reduce((t, line) => t + line[key], 0);
      // Eleven starters, then up to three substitutes.
      assert.equal(lines.filter((line) => !line.sub).length, 11);
      assert.ok(lines.length <= 11 + MAX_SUBS);
      assert.ok(sum('min') <= 11 * 90);
      assert.equal(sum('g'), goals);
      assert.equal(sum('a'), r.goals.filter((g) => g.side === s && g.assistId).length);
      assert.equal(sum('sh'), r.stats[s].shots);
      assert.equal(sum('sot'), r.stats[s].onTarget);
      // Every shot on target the other side had was either a goal or a save.
      const theirGoals = s === 0 ? r.awayGoals : r.homeGoals;
      assert.equal(sum('sv'), r.stats[1 - s].onTarget - theirGoals);
      for (const line of lines) {
        assert.ok(line.min >= 0 && line.min <= 90);
        if (!line.sub && !line.off) assert.equal(line.min, 90);
        if (line.sub) assert.ok(line.min <= 90 - line.sub + 1);
        assert.ok(line.rating >= 1 && line.rating <= 10);
        assert.equal(line.rating, Math.round(line.rating * 10) / 10);
        assert.ok(!('delta' in line));
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

const fresh = (seed, managers = ['none', 'none']) =>
  createMatch({ home: { ...side(clubA), manager: managers[0] }, away: { ...side(clubB), manager: managers[1] }, seed });

test('substitutions: three a side, the newcomer takes the same position, minutes are counted', () => {
  const state = fresh('subs');
  for (let i = 0; i < 60; i++) stepMinute(state);
  const team = state.teams[0];
  const leaving = team.eleven.find((x) => x.role === 'MID');
  const coming = bestReplacement(team, 'MID');
  const event = substitute(state, 0, leaving.player.id, coming.id);
  assert.equal(event.type, 'sub');
  assert.equal(team.subsLeft, MAX_SUBS - 1);
  assert.equal(team.eleven.length, 11);
  const entry = team.eleven.find((x) => x.player.id === coming.id);
  assert.equal(entry.role, 'MID');
  assert.equal(entry.energy, 1);
  assert.ok(!team.bench.some((p) => p.id === coming.id));
  // Nonsense is refused: a player not on the pitch, or one not on the bench.
  assert.equal(substitute(state, 0, leaving.player.id, team.bench[0].id), null);
  assert.equal(substitute(state, 0, team.eleven[1].player.id, coming.id), null);
  substitute(state, 0, team.eleven[1].player.id, team.bench[0].id);
  substitute(state, 0, team.eleven[2].player.id, team.bench[0].id);
  assert.equal(team.subsLeft, 0);
  assert.equal(substitute(state, 0, team.eleven[3].player.id, team.bench[0].id), null);
  while (!state.finished) stepMinute(state);
  const lines = matchResult(state).players[0];
  assert.equal(lines.length, 14);
  assert.equal(lines.find((line) => line.id === leaving.player.id).min, 60);
  assert.equal(lines.find((line) => line.id === leaving.player.id).off, 60);
  assert.equal(lines.find((line) => line.id === coming.id).min, 30);
  assert.equal(lines.find((line) => line.id === coming.id).sub, 60);
});

test('players tire, and pressing or a fast tempo tires them faster', () => {
  const normal = fresh('tired');
  const pressing = fresh('tired');
  setTactics(pressing, 0, { pressing: 1, tempo: 1 });
  setTactics(pressing, 1, { pressing: 9, line: -7 }); // out-of-range values are clamped
  assert.deepEqual(pressing.teams[1].tactics, { pressing: 1, line: -1, tempo: 0 });
  for (let i = 0; i < 90; i++) { stepMinute(normal); stepMinute(pressing); }
  const energy = (state) => state.teams[0].eleven.filter((x) => x.role !== 'GK').reduce((t, x) => t + x.energy, 0);
  assert.ok(energy(pressing) < energy(normal) - 0.5);
  for (const x of normal.teams[0].eleven) {
    assert.ok(x.energy > 0.2 && x.energy < 1);
    assert.ok(currentRate(x) < x.rate);
  }
  const keeper = normal.teams[0].eleven.find((x) => x.role === 'GK');
  assert.ok(normal.teams[0].eleven.every((x) => x === keeper || x.energy < keeper.energy));
});

test('AI managers use their substitutes; a side left alone does not', () => {
  let used = 0;
  for (let i = 0; i < 30; i++) {
    const state = fresh(`ai-${i}`, ['ai', 'none']);
    while (!state.finished) stepMinute(state);
    used += MAX_SUBS - state.teams[0].subsLeft;
    assert.ok(state.teams[1].subsLeft === MAX_SUBS || state.events.some((e) => e.type === 'injury' && e.side === 1));
  }
  assert.ok(used > 30);
});

test('a red card leaves the side a man short; an injury can be covered from the bench', () => {
  let red = null;
  let injury = null;
  for (let i = 0; i < 400 && !(red && injury); i++) {
    const state = fresh(`incident-${i}`, ['user', 'none']);
    while (!state.finished) {
      const events = stepMinute(state);
      for (const e of events) {
        if (e.type === 'red' && !red) {
          red = true;
          const team = state.teams[e.side];
          assert.ok(team.eleven.length < 11);
          assert.ok(!team.eleven.some((x) => x.player.id === e.playerId));
          assert.equal(team.off.find((x) => x.player.id === e.playerId).line.rc, 1);
        }
        if (e.type === 'injury' && e.side === 0 && !injury) {
          injury = true;
          const team = state.teams[0];
          assert.ok(e.out >= 1 && e.out <= 6);
          assert.ok(e.needsSub);
          const before = team.eleven.length;
          const replacement = bestReplacement(team, e.role);
          assert.equal(replaceInjured(state, 0, replacement.id, e.role).type, 'sub');
          assert.equal(team.eleven.length, before + 1);
          assert.equal(team.eleven.filter((x) => x.role === 'GK').length, 1);
        }
      }
    }
    // Whatever happened, there is always exactly one keeper per side.
    for (const team of state.teams) assert.equal(team.eleven.filter((x) => x.role === 'GK').length, 1);
  }
  assert.ok(red && injury);
});

test('a match with changes made mid-way still resumes exactly after being saved', () => {
  const run = (save) => {
    const state = fresh('resume', ['user', 'ai']);
    for (let i = 0; i < 55; i++) stepMinute(state);
    setTactics(state, 0, { pressing: 1 });
    substitute(state, 0, state.teams[0].eleven[9].player.id, state.teams[0].bench[2].id);
    const live = save ? JSON.parse(JSON.stringify(state)) : state;
    while (!live.finished) stepMinute(live);
    return matchResult(live);
  };
  assert.deepEqual(run(true), run(false));
});

test('suspensions and injuries are worked out from results', () => {
  const results = [
    { round: 3, homeId: 'a', awayId: 'b', incidents: [{ type: 'red', side: 0, playerId: 'p1' }, { type: 'injury', side: 1, playerId: 'q1', out: 2 }, { type: 'yellow', side: 0, playerId: 'p2' }] },
    { round: 4, homeId: 'c', awayId: 'a', incidents: [{ type: 'injury', side: 1, playerId: 'p3', out: 1 }] },
    { round: 1, homeId: 'a', awayId: 'd' }, // an old result with no incidents recorded
  ];
  assert.deepEqual([...unavailable(results, 'a', 4)], [['p1', { reason: 'suspended', rounds: 1 }]]);
  assert.deepEqual([...unavailable(results, 'a', 5)], [['p3', { reason: 'injured', rounds: 1 }]]);
  assert.equal(unavailable(results, 'a', 6).size, 0);
  assert.deepEqual([...unavailable(results, 'b', 4)], [['q1', { reason: 'injured', rounds: 2 }]]);
  assert.deepEqual([...unavailable(results, 'b', 5)], [['q1', { reason: 'injured', rounds: 1 }]]);
  assert.equal(unavailable(results, 'b', 6).size, 0);
});

test('over a season nobody plays while suspended or injured', () => {
  const season = simulateSeason(world, 1);
  let checked = 0;
  for (const r of season.results) {
    for (const e of r.incidents) {
      if (e.type !== 'red' && e.type !== 'injury') continue;
      const clubId = e.side === 0 ? r.homeId : r.awayId;
      const rounds = e.type === 'red' ? 1 : e.out;
      for (const later of season.results) {
        if (later.round <= r.round || later.round > r.round + rounds) continue;
        if (later.homeId !== clubId && later.awayId !== clubId) continue;
        assert.ok(!later.players.flat().some((line) => line.id === e.playerId), `${e.playerId} played in round ${later.round}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 20);
});
