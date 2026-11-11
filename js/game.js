// The game itself: starting a save, picking a team, playing a round, reading
// tables and stats. No screen code here, so it all runs in Node for tests.
//
// A save holds the world, which club is yours, your line-up, and every result
// so far. Fixtures, tables, form and stats are always worked out, never stored.

import { generateWorld } from './world.js';
import { FORMATIONS, pickXI, bestLineup, teamStrength, lineupQuality } from './team.js';
import { fixturesFor, playFixture, tableFromResults } from './league.js';
import { playerTotals, leaders, minAppsForRating } from './stats.js';
import { positionRating } from './player.js';

export const SAVE_VERSION = 1;
export const ROUNDS = 22;

// ---------- Saves ----------

/**
 * Start a new game. Pass clubId to manage an existing bottom-division club, or
 * customClubName to create your own (it takes the place of one of the twelve).
 */
export function newGame({ seed, clubId, customClubName, now = Date.now() }) {
  const name = customClubName ? String(customClubName).trim() : '';
  const world = generateWorld(seed, name ? { customClubName: name } : {});
  const userClubId = name ? world.clubs.find((c) => c.custom).id : clubId;
  const club = world.clubs.find((c) => c.id === userClubId);
  if (!club || club.divisionIndex !== world.divisions.length - 1) {
    throw new Error('You can only start with a club from the bottom division');
  }
  const save = {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    world,
    userClubId,
    season: 1,
    round: 0, // rounds played so far this season
    results: [],
    lineup: null,
  };
  save.lineup = storeLineup(bestLineup(world.players.filter((p) => p.clubId === userClubId)));
  return save;
}

// Each entry upgrades a save from that version to the next. Saves are never wiped.
const MIGRATIONS = {
  // 1: (save) => { ...changes for version 2...; save.version = 2; },
};

/** Bring an older save up to the current format. */
export function migrate(save) {
  while (save.version < SAVE_VERSION) {
    const step = MIGRATIONS[save.version];
    if (!step) throw new Error(`No upgrade path from save version ${save.version}`);
    step(save);
  }
  return save;
}

const storeLineup = (lineup) => ({
  formation: lineup.formation,
  slots: lineup.players.map((x) => ({ playerId: x.player.id, role: x.role })),
});

// ---------- An open game ----------

/** Open a save for play: builds the look-ups and fixtures that aren't stored. */
export function openGame(save) {
  migrate(save);
  const g = {
    save,
    world: save.world,
    players: new Map(save.world.players.map((p) => [p.id, p])),
    clubs: new Map(save.world.clubs.map((c) => [c.id, c])),
    squads: new Map(),
    rounds: [],
    ai: new Map(),
    cache: {},
  };
  for (const p of save.world.players) {
    if (!g.squads.has(p.clubId)) g.squads.set(p.clubId, []);
    g.squads.get(p.clubId).push(p);
  }
  g.rounds = save.world.divisions.map((d) => fixturesFor(save.world, save.season, d.index));
  if (!validLineup(g, save.lineup)) save.lineup = storeLineup(bestLineup(squad(g, save.userClubId)));
  return g;
}

export const userClub = (g) => g.clubs.get(g.save.userClubId);
export const userDivision = (g) => userClub(g).divisionIndex;
export const squad = (g, clubId) => g.squads.get(clubId) || [];
export const seasonOver = (g) => g.save.round >= ROUNDS;

function validLineup(g, stored) {
  if (!stored || !FORMATIONS[stored.formation] || !Array.isArray(stored.slots)) return false;
  if (stored.slots.length !== 11) return false;
  const shape = { GK: 1, ...FORMATIONS[stored.formation] };
  const seen = new Set();
  const count = { GK: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const slot of stored.slots) {
    const p = g.players.get(slot.playerId);
    if (!p || p.clubId !== g.save.userClubId || seen.has(p.id) || !(slot.role in count)) return false;
    seen.add(p.id);
    count[slot.role]++;
  }
  return Object.keys(count).every((role) => count[role] === shape[role]);
}

// ---------- Team selection ----------

/** Your line-up in the form the match engine takes. */
export function userLineup(g) {
  const { formation, slots } = g.save.lineup;
  const players = slots.map((s) => ({ player: g.players.get(s.playerId), role: s.role }));
  const picked = new Set(slots.map((s) => s.playerId));
  return { formation, players, bench: squad(g, g.save.userClubId).filter((p) => !picked.has(p.id)) };
}

export function lineupFor(g, clubId) {
  if (clubId === g.save.userClubId) return userLineup(g);
  if (!g.ai.has(clubId)) g.ai.set(clubId, bestLineup(squad(g, clubId)));
  return g.ai.get(clubId);
}

/** Change formation. The best eleven for the new shape is picked for you. */
export function setFormation(g, formation) {
  g.save.lineup = storeLineup(pickXI(squad(g, g.save.userClubId), formation));
}

/** Pick the best eleven for the current formation. */
export function autoPick(g) {
  setFormation(g, g.save.lineup.formation);
}

/**
 * Put a player into a slot. If he is already in the eleven, the two players
 * swap places; otherwise the player he replaces drops to the bench.
 */
export function selectPlayer(g, slotIndex, playerId) {
  const slots = g.save.lineup.slots;
  const player = g.players.get(playerId);
  if (!slots[slotIndex] || !player || player.clubId !== g.save.userClubId) return false;
  const other = slots.findIndex((s) => s.playerId === playerId);
  if (other === slotIndex) return true;
  if (other >= 0) slots[other].playerId = slots[slotIndex].playerId;
  slots[slotIndex].playerId = playerId;
  return true;
}

export function lineupStrength(g) {
  const lineup = userLineup(g);
  return { ...teamStrength(lineup), quality: lineupQuality(lineup) };
}

/** How good each club's best eleven is: used on the new-game screen. */
export function clubQuality(world, clubId) {
  return lineupQuality(bestLineup(world.players.filter((p) => p.clubId === clubId)));
}

// ---------- Fixtures and playing ----------

/** Your 22 fixtures, each with its result once played. */
export function userFixtures(g) {
  const id = g.save.userClubId;
  const mine = g.save.results.filter((r) => r.homeId === id || r.awayId === id);
  return g.rounds[userDivision(g)].map((round, index) => {
    const fixture = round.find((f) => f.home === id || f.away === id);
    const atHome = fixture.home === id;
    return {
      round: index + 1,
      atHome,
      opponentId: atHome ? fixture.away : fixture.home,
      result: mine.find((r) => r.round === index + 1) || null,
    };
  });
}

export function nextFixture(g) {
  return seasonOver(g) ? null : userFixtures(g)[g.save.round];
}

/**
 * Play the next round in every division. Your match uses your line-up; AI
 * managers pick everyone else's. Returns your result.
 */
export function playRound(g, now = Date.now()) {
  if (seasonOver(g)) return null;
  const roundIndex = g.save.round;
  let mine = null;
  g.rounds.forEach((rounds, divisionIndex) => {
    for (const fixture of rounds[roundIndex]) {
      const result = playFixture(g.world, g.save.season, divisionIndex, roundIndex, fixture, (id) =>
        lineupFor(g, id),
      );
      g.save.results.push(result);
      if (result.homeId === g.save.userClubId || result.awayId === g.save.userClubId) mine = result;
    }
  });
  g.save.round++;
  g.save.updatedAt = now;
  g.cache = {};
  return mine;
}

// ---------- Tables and stats (all derived) ----------

const cached = (g, key, make) => (key in g.cache ? g.cache[key] : (g.cache[key] = make()));

export const divisionResults = (g, divisionIndex) =>
  cached(g, `results-${divisionIndex}`, () => g.save.results.filter((r) => r.divisionIndex === divisionIndex));

export const roundResults = (g, divisionIndex, round) =>
  divisionResults(g, divisionIndex).filter((r) => r.round === round);

export const table = (g, divisionIndex) =>
  cached(g, `table-${divisionIndex}`, () =>
    tableFromResults(g.world.divisions[divisionIndex].clubIds, divisionResults(g, divisionIndex), (id) => g.clubs.get(id).name),
  );

/** 1-based league position of a club in its division. */
export const positionOf = (g, clubId) =>
  table(g, g.clubs.get(clubId).divisionIndex).findIndex((row) => row.clubId === clubId) + 1;

export const totals = (g, divisionIndex) =>
  cached(g, `totals-${divisionIndex}`, () => playerTotals(divisionResults(g, divisionIndex)));

/** Top ten in a division by 'goals', 'assists' or 'rating'. */
export function topTen(g, divisionIndex, key) {
  return leaders(totals(g, divisionIndex), key, {
    minApps: minAppsForRating(divisionResults(g, divisionIndex)),
    nameOf: (id) => g.players.get(id).name,
  });
}

const NO_STATS = { apps: 0, goals: 0, assists: 0, rating: 0, best: 0, potm: 0, cleanSheets: 0, form: [] };

/** One row per player in your squad with his season totals. */
export function squadStats(g, clubId = g.save.userClubId) {
  const all = totals(g, g.clubs.get(clubId).divisionIndex);
  return squad(g, clubId).map((player) => ({ player, stats: all.get(player.id) || NO_STATS }));
}

export const playerStats = (g, playerId) => {
  const player = g.players.get(playerId);
  return totals(g, g.clubs.get(player.clubId).divisionIndex).get(playerId) || NO_STATS;
};

/** Your won-drawn-lost record and league position, for the home screen and slot card. */
export function summary(g) {
  const club = userClub(g);
  const row = table(g, club.divisionIndex).find((r) => r.clubId === club.id);
  return {
    clubName: club.name,
    divisionName: g.world.divisions[club.divisionIndex].name,
    season: g.save.season,
    round: g.save.round,
    rounds: ROUNDS,
    position: positionOf(g, club.id),
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    points: row.points,
    updatedAt: g.save.updatedAt,
    worldCode: g.world.seed,
  };
}

/** "C. Akehurst" for tight tables. */
export function shortName(name) {
  const parts = name.split(' ');
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
}

export { positionRating, FORMATIONS };
