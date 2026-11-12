// The game itself: starting a save, picking a team, playing a round, reading
// tables and stats. No screen code here, so it all runs in Node for tests.
//
// A save holds the world, which club is yours, your line-up, and every result
// so far. Fixtures, tables, form and stats are always worked out, never stored.

import { generateWorld } from './world.js';
import { FORMATIONS, DEFAULT_TACTICS, pickXI, bestLineup, teamStrength, lineupQuality } from './team.js';
import { fixturesFor, playFixture, startFixture, resultOf, unavailable, tableFromResults } from './league.js';
import { stepMinute } from './match.js';
import { playerTotals, leaders, minAppsForRating } from './stats.js';
import { positionRating } from './player.js';

export const SAVE_VERSION = 2;
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
  // Version 2 (M3): tactics are part of your line-up. Older results simply have
  // no cards, injuries or substitutions in them.
  1: (save) => {
    if (save.lineup) save.lineup.tactics = { ...DEFAULT_TACTICS };
    save.version = 2;
  },
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

const storeLineup = (lineup, tactics = DEFAULT_TACTICS) => ({
  formation: lineup.formation,
  slots: lineup.players.map((x) => ({ playerId: x.player.id, role: x.role })),
  tactics: { ...tactics },
});

const cached = (g, key, make) => (key in g.cache ? g.cache[key] : (g.cache[key] = make()));

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
  if (!validLineup(g, save.lineup)) save.lineup = storeLineup(bestLineup(available(g, save.userClubId)), save.lineup?.tactics);
  save.lineup.tactics = { ...DEFAULT_TACTICS, ...(save.lineup.tactics || {}) };
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

// ---------- Who is available ----------

/** Players a club can't pick for the next round: Map of id -> { reason, rounds }. */
export function missing(g, clubId) {
  return cached(g, `missing-${clubId}`, () =>
    unavailable(g.save.results.filter((r) => r.homeId === clubId || r.awayId === clubId), clubId, g.save.round + 1),
  );
}

/** A club's squad without anyone suspended or injured for the next round. */
export function available(g, clubId) {
  const out = missing(g, clubId);
  return out.size ? squad(g, clubId).filter((p) => !out.has(p.id)) : squad(g, clubId);
}

// ---------- Team selection ----------

/** Your line-up in the form the match engine takes. The bench is everyone else who is available. */
export function userLineup(g) {
  const { formation, slots } = g.save.lineup;
  const players = slots.map((s) => ({ player: g.players.get(s.playerId), role: s.role }));
  const picked = new Set(slots.map((s) => s.playerId));
  return { formation, players, bench: available(g, g.save.userClubId).filter((p) => !picked.has(p.id)) };
}

/** Players in your eleven who can't play the next match. The match can't start until this is empty. */
export function lineupProblems(g) {
  const out = missing(g, g.save.userClubId);
  return g.save.lineup.slots
    .filter((s) => out.has(s.playerId))
    .map((s) => ({ player: g.players.get(s.playerId), ...out.get(s.playerId) }));
}

export function lineupFor(g, clubId) {
  if (clubId === g.save.userClubId) return userLineup(g);
  return cached(g, `ai-${clubId}`, () => bestLineup(available(g, clubId)));
}

/** Change formation. The best available eleven for the new shape is picked for you. */
export function setFormation(g, formation) {
  g.save.lineup = storeLineup(pickXI(available(g, g.save.userClubId), formation), g.save.lineup.tactics);
}

/** Pick the best available eleven for the current formation. */
export function autoPick(g) {
  setFormation(g, g.save.lineup.formation);
}

/** Set one of your tactics: 'pressing', 'line' or 'tempo', to -1, 0 or 1. */
export function setTactic(g, key, value) {
  if (!(key in DEFAULT_TACTICS)) return;
  g.save.lineup.tactics[key] = Math.max(-1, Math.min(1, Math.round(value)));
}

/**
 * Put a player into a slot. If he is already in the eleven, the two players
 * swap places; otherwise the player he replaces drops to the bench.
 * Suspended and injured players can't be picked.
 */
export function selectPlayer(g, slotIndex, playerId) {
  const slots = g.save.lineup.slots;
  const player = g.players.get(playerId);
  if (!slots[slotIndex] || !player || player.clubId !== g.save.userClubId) return false;
  if (missing(g, g.save.userClubId).has(playerId)) return false;
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

const sideFor = (g, manager) => (id) =>
  id === g.save.userClubId
    ? { lineup: userLineup(g), tactics: g.save.lineup.tactics, manager }
    : { lineup: lineupFor(g, id) };

/**
 * Kick off your next match and return its live state, to be played with
 * stepMinute() and finished with finishRound(). manager is 'user' when you are
 * watching and making the changes yourself, or 'ai-subs' to let your assistant
 * make the substitutions. Returns null if the season is over or your eleven
 * includes someone who can't play.
 */
export function startMatch(g, manager = 'user') {
  if (seasonOver(g) || lineupProblems(g).length) return null;
  const roundIndex = g.save.round;
  const d = userDivision(g);
  const fixture = g.rounds[d][roundIndex].find((f) => f.home === g.save.userClubId || f.away === g.save.userClubId);
  return startFixture(g.world, g.save.season, d, roundIndex, fixture, sideFor(g, manager));
}

/** Which side of a live match is yours: 0 for home, 1 for away. */
export const userSide = (g, state) => (state.teams[0].clubId === g.save.userClubId ? 0 : 1);

/**
 * Record your finished match and play the rest of the round in every division.
 * Returns your result.
 */
export function finishRound(g, state, now = Date.now()) {
  if (!state.finished || seasonOver(g)) return null;
  const roundIndex = g.save.round;
  const mine = resultOf(state, userDivision(g), roundIndex);
  const others = [];
  g.rounds.forEach((rounds, divisionIndex) => {
    for (const fixture of rounds[roundIndex]) {
      if (fixture.home === mine.homeId && fixture.away === mine.awayId) continue;
      others.push(playFixture(g.world, g.save.season, divisionIndex, roundIndex, fixture, sideFor(g, 'ai')));
    }
  });
  g.save.results.push(mine, ...others);
  g.save.round++;
  g.save.updatedAt = now;
  g.cache = {};
  return mine;
}

/**
 * Skip straight to the result: your assistant makes the substitutions, and
 * your tactics stay as you set them. Returns your result, or null if the
 * match can't start.
 */
export function playRound(g, now = Date.now()) {
  const state = startMatch(g, 'ai-subs');
  if (!state) return null;
  while (!state.finished) stepMinute(state);
  return finishRound(g, state, now);
}

// ---------- Tables and stats (all derived) ----------

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

const NO_STATS = { apps: 0, starts: 0, rated: 0, goals: 0, assists: 0, rating: 0, best: 0, potm: 0, cleanSheets: 0, yellows: 0, reds: 0, form: [] };

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

export { positionRating, FORMATIONS, DEFAULT_TACTICS };
