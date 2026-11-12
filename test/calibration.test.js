// The engine must keep producing believable football. These run thousands of
// matches, so they take a second or two.

import test from 'node:test';
import assert from 'node:assert/strict';

import { measure, measureDivisionGap, measureFormations, measureTactics, TARGETS, inTarget } from '../js/calibrate.js';

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

test('player ratings follow the Football Manager scale: about 6.8, no position favoured', () => {
  assert.ok(inTarget(stats.ratingMean, TARGETS.ratingMean), `average rating ${stats.ratingMean.toFixed(2)}`);
  assert.ok(
    stats.ratingRoleSpread <= TARGETS.ratingRoleSpread,
    Object.entries(stats.ratingByRole).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' '),
  );
  // Excellent and poor games both happen, and neither is common.
  assert.ok(stats.ratingHigh > 0.02 && stats.ratingHigh < 0.1, `8.0+ ${(stats.ratingHigh * 100).toFixed(1)}%`);
  assert.ok(stats.ratingLow > 0.02 && stats.ratingLow < 0.12, `under 6.0 ${(stats.ratingLow * 100).toFixed(1)}%`);
  assert.ok(stats.ratingPerfect < 0.005);
});

test('ratings reflect results and ability without being decided by either', () => {
  const gap = stats.ratingWinners - stats.ratingLosers;
  assert.ok(gap > 0.4 && gap < 1.2, `winners v losers ${gap.toFixed(2)}`);
  assert.ok(stats.abilityCorrelation > 0.35 && stats.abilityCorrelation < 0.9);
  // Player of the match is not always a striker.
  assert.ok(stats.potmShare.ATT < 0.55);
  for (const role of ['GK', 'DEF', 'MID']) assert.ok(stats.potmShare[role] > 0.08, role);
});

test('season leaders look right for a 22-game season', () => {
  assert.ok(stats.avgTopScorerGoals > 11 && stats.avgTopScorerGoals < 26);
  assert.ok(stats.avgTopAssists > 5 && stats.avgTopAssists < 16);
  assert.ok(stats.avgTopRating > 7.0 && stats.avgTopRating < 8.0);
});

test('cards, injuries and substitutions happen about as often as in real football', () => {
  assert.ok(stats.yellowsPerTeam > 0.7 && stats.yellowsPerTeam < 2.2, `yellows per team ${stats.yellowsPerTeam.toFixed(2)}`);
  assert.ok(stats.redsPerMatch > 0.05 && stats.redsPerMatch < 0.25, `reds per match ${stats.redsPerMatch.toFixed(2)}`);
  assert.ok(stats.injuriesPerMatch > 0.08 && stats.injuriesPerMatch < 0.3, `injuries per match ${stats.injuriesPerMatch.toFixed(2)}`);
  assert.ok(stats.subsPerTeam > 1.2 && stats.subsPerTeam <= 3);
  // Injuries, suspensions and substitutions bring more of the squad into play.
  assert.ok(stats.playersUsedPerClub > 13);
});

test('no tactical setting is simply better than leaving everything on normal', () => {
  const ppg = measureTactics(2, 'tactics-test');
  for (const [name, value] of Object.entries(ppg)) {
    assert.ok(Math.abs(value - ppg.neutral) < 0.07, `${name}: ${value.toFixed(3)} v ${ppg.neutral.toFixed(3)}`);
  }
});
