import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld } from '../js/world.js';
import { simulateSeason } from '../js/league.js';
import { playerTotals, leaders, minAppsForRating } from '../js/stats.js';

const world = generateWorld('stats-tests');
const { results } = simulateSeason(world, 1);
const division = results.filter((r) => r.divisionIndex === 3);
const totals = playerTotals(division);
const nameOf = (id) => world.players.find((p) => p.id === id).name;

test('season totals are worked out from the match lines and add up', () => {
  const goals = division.reduce((t, r) => t + r.homeGoals + r.awayGoals, 0);
  const all = [...totals.values()];
  assert.equal(all.reduce((t, p) => t + p.goals, 0), goals);
  assert.equal(all.reduce((t, p) => t + p.potm, 0), division.length);
  assert.equal(all.reduce((t, p) => t + p.apps, 0), division.length * 22);
  for (const p of all) {
    assert.ok(p.apps >= 1 && p.apps <= 22);
    assert.equal(p.minutes, p.apps * 90);
    assert.ok(p.rating >= 1 && p.rating <= 10);
    assert.ok(p.form.length <= 5 && p.form.length === Math.min(5, p.apps));
    assert.ok(p.best >= p.rating);
    assert.ok(world.clubs.find((c) => c.id === p.clubId).divisionIndex === 3);
  }
});

test('top tens are in order, and average rating needs enough appearances', () => {
  assert.equal(minAppsForRating(division), 11);
  assert.equal(minAppsForRating(division.filter((r) => r.round <= 5)), 3);
  for (const key of ['goals', 'assists', 'rating']) {
    const top = leaders(totals, key, { minApps: 11, nameOf });
    assert.equal(top.length, 10);
    for (let i = 1; i < top.length; i++) assert.ok(top[i - 1][key] >= top[i][key]);
    if (key === 'rating') for (const p of top) assert.ok(p.apps >= 11);
  }
  // One superb game early on must not top the ratings chart.
  const early = playerTotals(division.filter((r) => r.round <= 6));
  const oneGame = { ...[...early.values()][0], id: 'x', apps: 1, rating: 9.9 };
  early.set('x', oneGame);
  assert.ok(!leaders(early, 'rating', { minApps: 3 }).some((p) => p.id === 'x'));
  assert.equal(leaders(totals, 'goals', { limit: 3 }).length, 3);
});
