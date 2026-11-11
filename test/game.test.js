import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { generateWorld } from '../js/world.js';
import {
  newGame, openGame, migrate, SAVE_VERSION, ROUNDS, userClub, userLineup, setFormation, autoPick,
  selectPlayer, lineupStrength, userFixtures, nextFixture, playRound, seasonOver, table, positionOf,
  topTen, squadStats, summary, squad, shortName, roundResults, FORMATIONS,
} from '../js/game.js';

const bottomClub = (seed) => generateWorld(seed).divisions[3].clubIds[4];

test('a new game starts you at a bottom-division club with a valid eleven', () => {
  const save = newGame({ seed: 'G1', clubId: bottomClub('G1'), now: 1000 });
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(save.round, 0);
  assert.equal(save.results.length, 0);
  const g = openGame(save);
  assert.equal(userClub(g).divisionIndex, 3);
  const lineup = userLineup(g);
  assert.equal(lineup.players.length, 11);
  assert.equal(lineup.bench.length, 11);
  assert.equal(lineup.players.filter((x) => x.role === 'GK').length, 1);
  assert.throws(() => newGame({ seed: 'G1', clubId: generateWorld('G1').divisions[0].clubIds[0] }));
});

test('you can create your own club, which takes one of the bottom twelve places', () => {
  const save = newGame({ seed: 'G2', customClubName: '  Goodwin Athletic ' });
  const g = openGame(save);
  assert.equal(userClub(g).name, 'Goodwin Athletic');
  assert.equal(userClub(g).divisionIndex, 3);
  assert.equal(g.world.clubs.length, 48);
  assert.equal(squad(g, save.userClubId).length, 22);
});

test('team selection: formation, auto-pick, swapping in and swapping places', () => {
  const g = openGame(newGame({ seed: 'G3', clubId: bottomClub('G3') }));
  for (const [name, shape] of Object.entries(FORMATIONS)) {
    setFormation(g, name);
    const lineup = userLineup(g);
    assert.equal(lineup.formation, name);
    for (const role of ['DEF', 'MID', 'ATT']) {
      assert.equal(lineup.players.filter((x) => x.role === role).length, shape[role]);
    }
  }
  setFormation(g, '4-4-2');
  const before = userLineup(g);
  const bench = before.bench[0];
  const replaced = before.players[5].player;
  // Bring a bench player into slot 5.
  assert.ok(selectPlayer(g, 5, bench.id));
  let now = userLineup(g);
  assert.equal(now.players[5].player.id, bench.id);
  assert.ok(now.bench.some((p) => p.id === replaced.id));
  assert.equal(new Set(now.players.map((x) => x.player.id)).size, 11);
  // Pick someone already in the eleven for another slot: they swap places.
  const a = now.players[2].player.id;
  const b = now.players[8].player.id;
  assert.ok(selectPlayer(g, 2, b));
  now = userLineup(g);
  assert.equal(now.players[2].player.id, b);
  assert.equal(now.players[8].player.id, a);
  assert.equal(now.players[2].role, before.players[2].role);
  // Another club's player is refused.
  assert.equal(selectPlayer(g, 0, g.world.players.find((p) => p.clubId !== g.save.userClubId).id), false);
  // A weakened team is weaker; auto-pick restores the best eleven.
  const weak = lineupStrength(g).quality;
  autoPick(g);
  assert.ok(lineupStrength(g).quality >= weak);
  assert.deepEqual(userLineup(g).players.map((x) => x.player.id), before.players.map((x) => x.player.id));
});

test('a full season: 22 rounds, every division plays, tables and stats add up', () => {
  const g = openGame(newGame({ seed: 'G4', clubId: bottomClub('G4') }));
  assert.equal(userFixtures(g).length, ROUNDS);
  assert.equal(userFixtures(g).filter((f) => f.atHome).length, 11);
  for (let round = 1; round <= ROUNDS; round++) {
    const next = nextFixture(g);
    assert.equal(next.round, round);
    const mine = playRound(g, 5000 + round);
    assert.ok(mine.homeId === g.save.userClubId || mine.awayId === g.save.userClubId);
    assert.equal(mine.round, round);
    assert.equal(g.save.results.length, round * 24);
    assert.equal(roundResults(g, 3, round).length, 6);
    assert.equal(userFixtures(g)[round - 1].result, mine);
  }
  assert.ok(seasonOver(g));
  assert.equal(nextFixture(g), null);
  assert.equal(playRound(g), null);
  for (let d = 0; d < 4; d++) {
    const rows = table(g, d);
    assert.equal(rows.length, 12);
    for (const row of rows) assert.equal(row.played, 22);
  }
  const s = summary(g);
  assert.equal(s.played, 22);
  assert.equal(s.won + s.drawn + s.lost, 22);
  assert.equal(s.position, positionOf(g, g.save.userClubId));
  assert.ok(s.position >= 1 && s.position <= 12);
  assert.equal(s.updatedAt, 5022);
  for (const key of ['goals', 'assists', 'rating']) assert.equal(topTen(g, 3, key).length, 10);
  const stats = squadStats(g);
  assert.equal(stats.length, 22);
  assert.equal(stats.reduce((t, row) => t + row.stats.apps, 0), 22 * 11);
  const row = table(g, 3).find((r) => r.clubId === g.save.userClubId);
  assert.equal(stats.reduce((t, r) => t + r.stats.goals, 0), row.gf);
});

test('your team selection changes your results, and only yours', () => {
  const play = (weaken) => {
    const g = openGame(newGame({ seed: 'G5', clubId: bottomClub('G5') }));
    if (weaken) {
      // Play the reserves: swap every outfield starter for a bench player.
      const lineup = userLineup(g);
      lineup.bench.filter((p) => p.pos !== 'GK').slice(0, 10).forEach((p, i) => selectPlayer(g, i + 1, p.id));
    }
    for (let i = 0; i < ROUNDS; i++) playRound(g);
    return g;
  };
  const best = play(false);
  const reserves = play(true);
  assert.ok(summary(best).points > summary(reserves).points);
  const others = (g) => g.save.results.filter((r) => r.divisionIndex !== 3).map((r) => [r.homeGoals, r.awayGoals]);
  assert.deepEqual(others(best), others(reserves));
});

test('a save survives being stored and reopened mid-season', () => {
  const g = openGame(newGame({ seed: 'G6', clubId: bottomClub('G6') }));
  setFormation(g, '4-3-3');
  for (let i = 0; i < 7; i++) playRound(g);
  const reopened = openGame(JSON.parse(JSON.stringify(g.save)));
  assert.deepEqual(summary(reopened), summary(g));
  assert.equal(userLineup(reopened).formation, '4-3-3');
  assert.deepEqual(table(reopened, 3), table(g, 3));
  // Carrying on from the reopened save gives the same next result.
  const a = playRound(g, 1);
  const b = playRound(reopened, 1);
  assert.deepEqual(a, b);
});

test('saves are upgraded, never wiped, and a broken line-up is repaired', () => {
  const save = newGame({ seed: 'G7', clubId: bottomClub('G7') });
  assert.equal(migrate(save), save);
  assert.throws(() => migrate({ version: 0 }));
  save.lineup.slots[3].playerId = 'nobody';
  const g = openGame(save);
  assert.equal(userLineup(g).players.length, 11);
  assert.ok(userLineup(g).players.every((x) => x.player));
});

test('short names fit tight tables', () => {
  assert.equal(shortName('Charlie Akehurst'), 'C. Akehurst');
  assert.equal(shortName('Pele'), 'Pele');
});

test('every file the app imports is in the service worker cache list', () => {
  const root = new URL('..', import.meta.url).pathname;
  const sw = readFileSync(`${root}sw.js`, 'utf8');
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(`${root}${file}`, 'utf8');
    for (const match of source.matchAll(/from '(\.[^']+)'/g)) {
      walk(new URL(match[1], `file:///${file}`).pathname.slice(1));
    }
  };
  walk('js/app.js');
  assert.ok(seen.size >= 10);
  for (const file of seen) assert.ok(sw.includes(`'./${file}'`), `${file} is missing from CORE in sw.js`);
  // Both version numbers match.
  const app = readFileSync(`${root}js/app.js`, 'utf8').match(/APP_VERSION = '(\d+)'/)[1];
  const worker = sw.match(/VERSION = 'grassroots-manager-v(\d+)'/)[1];
  assert.equal(app, worker);
  // Everything in the cache list exists.
  for (const match of sw.matchAll(/'\.\/([^']+)'/g)) readFileSync(`${root}${match[1]}`);
});
