// Team selection and the four unit strengths the match engine runs on.

import { positionRating } from './player.js';

export const FORMATIONS = {
  '4-4-2': { DEF: 4, MID: 4, ATT: 2 },
  '4-3-3': { DEF: 4, MID: 3, ATT: 3 },
  '4-5-1': { DEF: 4, MID: 5, ATT: 1 },
  '3-5-2': { DEF: 3, MID: 5, ATT: 2 },
  '5-3-2': { DEF: 5, MID: 3, ATT: 2 },
};

// Extra bodies in a line make it stronger and fewer make it weaker, measured in
// rating points. 4-4-2 is the neutral shape. Tuned so no formation dominates
// (see tools/calibrate.js).
// The smaller counts only happen after a red card or an injury with no substitutes left.
const COUNT_BONUS = {
  DEF: { 0: -6, 1: -4.5, 2: -2.8, 3: -1.3, 4: 0, 5: 0.9, 6: 1.5 },
  MID: { 0: -5, 1: -3.5, 2: -2, 3: -0.8, 4: 0, 5: 0.9, 6: 1.5 },
  ATT: { 0: -3.5, 1: -1.6, 2: 0, 3: 1.2, 4: 2 },
};

/** Rating points a line gains or loses for having this many players. */
export const countBonus = (role, count) => COUNT_BONUS[role][count] ?? 0;

// Tactics: three settings, each -1, 0 or +1.
// pressing: stand off / normal / press high. line: deep / normal / high. tempo: slow / normal / fast.
export const DEFAULT_TACTICS = { pressing: 0, line: 0, tempo: 0 };
export const TACTIC_LABELS = {
  pressing: ['Stand off', 'Normal', 'Press high'],
  line: ['Deep', 'Normal', 'High'],
  tempo: ['Slow', 'Normal', 'Fast'],
};

const meanAttr = (group, key) =>
  group.length ? group.reduce((sum, x) => sum + (x.player.attrs[key] ?? 3), 0) / group.length : 0;

/**
 * What an AI manager sets before kick-off, from how his eleven compares with
 * the opposition: press if fitter, hold a high line if his defenders are
 * quicker than their attackers, drop deep if they are clearly slower.
 */
export function chooseTactics(lineup, opponent) {
  const outfield = (l) => l.players.filter((x) => x.role !== 'GK');
  const stamina = meanAttr(outfield(lineup), 'stamina') - meanAttr(outfield(opponent), 'stamina');
  const mine = lineup.players.filter((x) => x.role === 'DEF');
  const theirs = opponent.players.filter((x) => x.role === 'ATT');
  const pace = meanAttr(mine, 'pace') - meanAttr(theirs, 'pace');
  return {
    pressing: stamina > 1 ? 1 : stamina < -1 ? -1 : 0,
    line: pace > 1.5 ? 1 : pace < -2 ? -1 : 0,
    tempo: 0,
  };
}

/**
 * Pick the best eleven for a formation.
 * Returns { formation, players: [{ player, role }] } with the keeper first.
 */
export function pickXI(squad, formation) {
  const shape = FORMATIONS[formation];
  if (!shape) throw new Error(`Unknown formation ${formation}`);

  const remaining = new Set(squad);
  const players = [];

  // Keeper first: the best available in goal.
  let keeper = null;
  for (const p of remaining) {
    if (!keeper || positionRating(p, 'GK') > positionRating(keeper, 'GK')) keeper = p;
  }
  remaining.delete(keeper);
  players.push({ player: keeper, role: 'GK' });

  // Then fill outfield slots best-fit first: repeatedly take the strongest
  // remaining player-for-a-role pairing where that role still has a slot.
  const open = { ...shape };
  const pairs = [];
  for (const p of remaining) {
    for (const role of ['DEF', 'MID', 'ATT']) {
      pairs.push({ player: p, role, rating: positionRating(p, role) });
    }
  }
  pairs.sort((a, b) => b.rating - a.rating || (a.player.id < b.player.id ? -1 : 1));
  for (const pair of pairs) {
    if (open[pair.role] > 0 && remaining.has(pair.player)) {
      open[pair.role]--;
      remaining.delete(pair.player);
      players.push({ player: pair.player, role: pair.role });
    }
  }

  const order = { GK: 0, DEF: 1, MID: 2, ATT: 3 };
  players.sort((a, b) => order[a.role] - order[b.role]);
  return { formation, players, bench: [...remaining] };
}

/** The four numbers the match engine uses: keeper, defence, midfield, attack. */
export function teamStrength(lineup) {
  const shape = FORMATIONS[lineup.formation];
  const unit = (role) => {
    const group = lineup.players.filter((x) => x.role === role);
    if (group.length === 0) return 1;
    const mean = group.reduce((sum, x) => sum + positionRating(x.player, role), 0) / group.length;
    const count = shape ? shape[role] : group.length;
    return mean + countBonus(role, count);
  };
  const keeper = lineup.players.find((x) => x.role === 'GK');
  return {
    gk: keeper ? positionRating(keeper.player, 'GK') : 1,
    def: unit('DEF'),
    mid: unit('MID'),
    att: unit('ATT'),
  };
}

/** One number for comparing line-ups: the mean rating of the eleven in their roles. */
export function lineupQuality(lineup) {
  return (
    lineup.players.reduce((sum, x) => sum + positionRating(x.player, x.role), 0) /
    lineup.players.length
  );
}

/** What an AI manager does: the formation that gets his best eleven on the pitch. */
export function bestLineup(squad) {
  let best = null;
  for (const formation of Object.keys(FORMATIONS)) {
    const lineup = pickXI(squad, formation);
    const quality = lineupQuality(lineup);
    if (!best || quality > best.quality + 1e-9) best = { lineup, quality };
  }
  return best.lineup;
}
