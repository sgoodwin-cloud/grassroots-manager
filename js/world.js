// World generator: four divisions of twelve clubs, each named after a real
// Sussex place, each with a generated squad. The whole world comes from one seed.

import { hashSeed, makeRng } from './rng.js';
import { PLACES, allowedSuffixes, isRealClubName } from './data/places.js';
import { FIRST_NAMES, SURNAMES } from './data/names.js';
import { generatePlayer, overall } from './player.js';

export const WORLD_VERSION = 1;
export const DIVISION_COUNT = 4;
export const CLUBS_PER_DIVISION = 12;

// Top to bottom. The league itself is fictional.
export const DIVISION_NAMES = ['Premier Division', 'Division One', 'Division Two', 'Division Three'];

// Typical key-attribute value for a mid-table club in each division, top to bottom.
export const DIVISION_LEVELS = [13, 11.2, 9.4, 7.6];

// How a 22-man squad is split.
export const SQUAD_SHAPE = { GK: 2, DEF: 7, MID: 7, ATT: 6 };

function makeName(rng, used) {
  for (let tries = 0; tries < 50; tries++) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(SURNAMES)}`;
}

/**
 * Generate a world.
 * seed: number or string. The same seed always gives the same world.
 * options.customClubName: replace one bottom-division club with the player's own club.
 */
export function generateWorld(seed, options = {}) {
  const rng = makeRng(hashSeed('world', seed));
  const clubCount = DIVISION_COUNT * CLUBS_PER_DIVISION;

  // Pick the places, then rank them: bigger places tend to sit higher.
  const chosen = rng.shuffle(PLACES).slice(0, clubCount);
  const ranked = chosen
    .map((place) => ({ place, score: place.size + rng.normal(0, 0.6) }))
    .sort((a, b) => b.score - a.score);

  const clubs = [];
  const players = [];
  const usedNames = new Set();

  ranked.forEach(({ place }, index) => {
    const divisionIndex = Math.floor(index / CLUBS_PER_DIVISION);
    const suffix = rng.pick(allowedSuffixes(place));
    const club = {
      id: `c${index}`,
      name: `${place.name} ${suffix}`,
      place: place.name,
      size: place.size,
      divisionIndex,
      // Clubs in a division aren't equal: some are a notch better or worse.
      level: DIVISION_LEVELS[divisionIndex] + rng.normal(0, 0.8),
      custom: false,
    };
    clubs.push(club);
  });

  // The player's own club, if they made one, takes one of the bottom twelve places.
  if (options.customClubName) {
    const bottom = clubs.filter((c) => c.divisionIndex === DIVISION_COUNT - 1);
    const club = rng.pick(bottom);
    club.name = String(options.customClubName).trim();
    club.place = null;
    club.custom = true;
  }

  for (const club of clubs) {
    let n = 0;
    for (const pos of Object.keys(SQUAD_SHAPE)) {
      for (let i = 0; i < SQUAD_SHAPE[pos]; i++) {
        const player = generatePlayer(rng, {
          id: `${club.id}p${n++}`,
          name: makeName(rng, usedNames),
          pos,
          level: club.level,
        });
        player.clubId = club.id;
        players.push(player);
      }
    }
  }

  const divisions = DIVISION_NAMES.map((name, index) => ({
    index,
    name,
    clubIds: clubs.filter((c) => c.divisionIndex === index).map((c) => c.id),
  }));

  return { version: WORLD_VERSION, seed: String(seed), divisions, clubs, players };
}

export function squadOf(world, clubId) {
  return world.players.filter((p) => p.clubId === clubId);
}

export function clubById(world, clubId) {
  return world.clubs.find((c) => c.id === clubId);
}

/** Average natural-position rating of a squad: a quick measure of club strength. */
export function squadStrength(world, clubId) {
  const squad = squadOf(world, clubId);
  return squad.reduce((sum, p) => sum + overall(p), 0) / squad.length;
}

export { isRealClubName };
