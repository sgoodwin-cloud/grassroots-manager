// The engine must keep producing believable football. These run thousands of
// matches, so they take a second or two.

import test from 'node:test';
import assert from 'node:assert/strict';

import { measure, measureDivisionGap, measureFormations, TARGETS, inTarget } from '../js/calibrate.js';

const stats = measure(40, 'calibration-test');

test('goals, home wins and draws sit inside the design-doc targets', () => {
  assert.ok(stats.matches >= 20000);
  assert.ok(inTarget(stats.goalsPerGame, TARGETS.goalsPerGame), `goals per game ${stats.goalsPerGame.toFixed(2)}`);
  assert.ok(inTarget(stats.homeWin, TARGETS.homeWin), `home wins ${(stats.homeWin * 100).toFixed(1)}%`);
  assert.ok(inTarget(stats.draw, TARGETS.draw), `draws ${(stats.draw * 100).toFixed(1)}%`);
});

test('matches look like football: shots, goalless draws and no absurd scores', () => {
  assert.ok(stats.shotsPerTeam > 9 && stats.shotsPerTeam < 15);
  assert.ok(stats.onTargetPerTeam > 3 && stats.onTargetPerTeam < 6);
  assert.ok(stats.goallessDraws > 0.04 && stats.goallessDraws < 0.1);
  assert.ok(stats.biggestWin.margin <= 12, stats.biggestWin.text);
  // Fewer than 2% of matches have eight or more goals.
  assert.ok(stats.goalsHistogram[8] / stats.matches < 0.02);
});

test('a clearly stronger side wins most of the time, not always', () => {
  const f = stats.favourite;
  assert.ok(f.matches > 1000);
  assert.ok(f.won / f.matches > 0.55 && f.won / f.matches < 0.8);
  assert.ok(f.lost / f.matches > 0.08);
});

test('squad strength shows in the table without deciding it', () => {
  const first = stats.strongestFinishedFirst / stats.divisions;
  assert.ok(first > 0.3 && first < 0.7, `strongest squad won ${(first * 100).toFixed(0)}%`);
  assert.ok(stats.weakestFinishedBottomThree / stats.divisions > 0.6);
  assert.ok(stats.avgChampionPoints > 42 && stats.avgChampionPoints < 56);
});

test('a club from the division above usually beats one from the division below', () => {
  for (const gap of measureDivisionGap(2000, 'gap-test')) {
    assert.ok(gap.won > 0.5 && gap.won < 0.75, `${gap.upper} v ${gap.lower}: ${(gap.won * 100).toFixed(0)}%`);
    assert.ok(gap.lost > 0.1);
  }
});

test('no formation is clearly better or worse than 4-4-2', () => {
  const ppg = measureFormations(2, 'formation-test');
  for (const [formation, value] of Object.entries(ppg)) {
    assert.ok(Math.abs(value - ppg['4-4-2']) < 0.06, `${formation}: ${value.toFixed(3)} v ${ppg['4-4-2'].toFixed(3)}`);
  }
});
