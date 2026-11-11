import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld, squadOf, SQUAD_SHAPE } from '../js/world.js';
import { PLACES, REAL_CLUBS, allowedSuffixes, isRealClubName } from '../js/data/places.js';
import { OUTFIELD_ATTRS, GK_ATTRS, overall, attributeBand, positionRating } from '../js/player.js';
import { hashSeed, makeRng } from '../js/rng.js';

test('random numbers repeat from the same seed and can resume from saved state', () => {
  const a = makeRng(hashSeed('x', 1));
  const b = makeRng(hashSeed('x', 1));
  const first = [a.next(), a.next(), a.next()];
  assert.deepEqual(first, [b.next(), b.next(), b.next()]);
  const resumed = makeRng(a.state);
  assert.equal(resumed.next(), a.next());
  assert.notEqual(hashSeed('x', 1), hashSeed('x', 2));
});

test('a world has four divisions of twelve clubs with 22-man squads', () => {
  const world = generateWorld('test');
  assert.equal(world.divisions.length, 4);
  assert.equal(world.clubs.length, 48);
  for (const division of world.divisions) assert.equal(division.clubIds.length, 12);
  for (const club of world.clubs) {
    const squad = squadOf(world, club.id);
    assert.equal(squad.length, 22);
    for (const pos of Object.keys(SQUAD_SHAPE)) {
      assert.equal(squad.filter((p) => p.pos === pos).length, SQUAD_SHAPE[pos]);
    }
  }
  assert.equal(new Set(world.players.map((p) => p.id)).size, 48 * 22);
});

test('the same seed gives the same world, a different seed a different one', () => {
  assert.deepEqual(generateWorld('abc'), generateWorld('abc'));
  assert.notDeepEqual(generateWorld('abc').clubs, generateWorld('abd').clubs);
});

test('players have the right attributes, all between 1 and 20', () => {
  const world = generateWorld('attrs');
  for (const p of world.players) {
    const keys = p.pos === 'GK' ? GK_ATTRS : OUTFIELD_ATTRS;
    assert.deepEqual(Object.keys(p.attrs).sort(), keys.slice().sort());
    for (const key of keys) {
      assert.ok(Number.isInteger(p.attrs[key]) && p.attrs[key] >= 1 && p.attrs[key] <= 20);
    }
    assert.ok(p.age >= 17 && p.age <= 36);
    assert.ok(p.potential >= overall(p) - 0.05 && p.potential <= 20);
    // A player is best in his own position.
    if (p.pos !== 'GK') assert.ok(positionRating(p, 'GK') < positionRating(p, p.pos));
  }
});

test('colour bands split at 5, 10 and 15', () => {
  assert.equal(attributeBand(1), 'poor');
  assert.equal(attributeBand(5), 'poor');
  assert.equal(attributeBand(6), 'average');
  assert.equal(attributeBand(10), 'average');
  assert.equal(attributeBand(11), 'good');
  assert.equal(attributeBand(15), 'good');
  assert.equal(attributeBand(16), 'excellent');
  assert.equal(attributeBand(20), 'excellent');
});

test('higher divisions have better squads', () => {
  const world = generateWorld('levels');
  const mean = (divisionIndex) => {
    const players = world.players.filter(
      (p) => world.clubs.find((c) => c.id === p.clubId).divisionIndex === divisionIndex,
    );
    return players.reduce((sum, p) => sum + overall(p), 0) / players.length;
  };
  assert.ok(mean(0) > mean(1) && mean(1) > mean(2) && mean(2) > mean(3));
});

test('no club name ever matches a real club, and none is a bare "FC"', () => {
  // Every name any place could produce.
  for (const place of PLACES) {
    const suffixes = allowedSuffixes(place);
    assert.ok(suffixes.length >= 2, `${place.name} needs at least two possible names`);
    for (const suffix of suffixes) {
      assert.ok(!isRealClubName(`${place.name} ${suffix}`), `${place.name} ${suffix} is a real club`);
      if (place.size < 3) assert.notEqual(suffix, 'Town');
    }
  }
  // And what actually comes out, over many worlds.
  for (let i = 0; i < 100; i++) {
    const world = generateWorld(`names-${i}`);
    const names = world.clubs.map((c) => c.name);
    assert.equal(new Set(names).size, 48);
    for (const name of names) {
      assert.ok(!isRealClubName(name), `${name} is a real club`);
      assert.ok(!/\bFC$/.test(name));
    }
  }
  assert.ok(isRealClubName('Lewes FC') && isRealClubName('AFC Varndeanians'));
  assert.ok(REAL_CLUBS.length > 100);
});

test('the place list includes Brighton and Hove neighbourhoods', () => {
  const names = PLACES.map((p) => p.name);
  for (const name of ['Westdene', 'Patcham', 'Hollingbury', 'Fishersgate']) {
    assert.ok(names.includes(name));
  }
  assert.equal(new Set(names).size, names.length);
  assert.ok(PLACES.filter((p) => p.bh).length >= 20);
});

test('a custom club takes one of the bottom twelve places', () => {
  const world = generateWorld('custom', { customClubName: 'Goodwin Athletic' });
  const custom = world.clubs.filter((c) => c.custom);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].name, 'Goodwin Athletic');
  assert.equal(custom[0].divisionIndex, 3);
  assert.equal(world.clubs.length, 48);
  assert.equal(squadOf(world, custom[0].id).length, 22);
});
