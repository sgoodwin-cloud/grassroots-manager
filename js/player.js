// Players: attributes on a 1-20 scale, position ratings worked out from them
// (never stored), and generation.

export const POSITIONS = ['GK', 'DEF', 'MID', 'ATT'];

export const OUTFIELD_ATTRS = [
  'finishing', 'passing', 'technique', 'tackling', 'positioning', 'pace', 'stamina', 'strength',
];
export const GK_ATTRS = [
  'handling', 'reflexes', 'distribution', 'positioning', 'pace', 'stamina', 'strength',
];

export const ATTR_LABELS = {
  finishing: 'Finishing', passing: 'Passing', technique: 'Technique', tackling: 'Tackling',
  positioning: 'Positioning', pace: 'Pace', stamina: 'Stamina', strength: 'Strength',
  handling: 'Handling', reflexes: 'Reflexes', distribution: 'Distribution',
};

const PHYSICAL = ['pace', 'stamina', 'strength'];

// How much each attribute counts towards playing a position. Each row sums to 1.
export const POSITION_WEIGHTS = {
  GK: { handling: 0.34, reflexes: 0.34, positioning: 0.16, distribution: 0.1, strength: 0.06 },
  DEF: {
    tackling: 0.3, positioning: 0.25, strength: 0.15, pace: 0.12, passing: 0.08, stamina: 0.06,
    technique: 0.04,
  },
  MID: {
    passing: 0.28, technique: 0.2, stamina: 0.14, positioning: 0.12, tackling: 0.12, pace: 0.08,
    finishing: 0.06,
  },
  ATT: {
    finishing: 0.32, technique: 0.2, pace: 0.18, strength: 0.1, passing: 0.1, positioning: 0.1,
  },
};

// A player out of position plays below his attributes.
export const FAMILIARITY = { natural: 1, accomplished: 0.92, unfamiliar: 0.8 };

// An attribute a player doesn't have at all (a keeper's finishing, a striker's handling).
const MISSING_ATTR = 3;

export function familiarity(player, pos) {
  if (player.pos === pos) return 'natural';
  if (player.alt === pos) return 'accomplished';
  return 'unfamiliar';
}

/** Rating from attributes alone, as if the position were natural. 1-20, not rounded. */
export function rawRating(attrs, pos) {
  const weights = POSITION_WEIGHTS[pos];
  let total = 0;
  for (const key in weights) total += weights[key] * (attrs[key] ?? MISSING_ATTR);
  return total;
}

/** How good this player is in this position, familiarity included. 1-20, not rounded. */
export function positionRating(player, pos) {
  return rawRating(player.attrs, pos) * FAMILIARITY[familiarity(player, pos)];
}

/** Rating in his natural position: the headline number for squad lists. */
export function overall(player) {
  return rawRating(player.attrs, player.pos);
}

/** Colour band for an attribute: 1-5 poor, 6-10 average, 11-15 good, 16-20 excellent. */
export function attributeBand(value) {
  if (value <= 5) return 'poor';
  if (value <= 10) return 'average';
  if (value <= 15) return 'good';
  return 'excellent';
}

const clampAttr = (v) => Math.max(1, Math.min(20, Math.round(v)));

/**
 * Generate one player.
 * level: the typical value of a key attribute at this club (about 7.5 in the
 * bottom division, 13 in the top).
 */
export function generatePlayer(rng, { id, name, pos, level }) {
  // Ages lean young-to-prime, with a tail of veterans.
  const age = Math.max(17, Math.min(36, Math.round(rng.normal(25.5, 4.6))));

  // Not yet developed, or past it.
  const youthGap = age < 22 ? (22 - age) * 0.55 : 0;
  const ageDecline = age > 30 ? (age - 30) * 0.5 : 0;

  // Each player is a bit better or worse than his club's level across the board.
  const quality = rng.normal(0, 1.1);

  const weights = POSITION_WEIGHTS[pos];
  const attrs = {};
  for (const key of pos === 'GK' ? GK_ATTRS : OUTFIELD_ATTRS) {
    const weight = weights[key] ?? 0;
    // Key attributes sit above the club level, irrelevant ones well below.
    const offset = weight >= 0.15 ? 1.4 : weight > 0 ? -0.6 : -3.2;
    let value = level + quality + offset + rng.normal(0, 1.9) - youthGap;
    if (PHYSICAL.includes(key)) value -= ageDecline;
    else value += Math.min(ageDecline, 2) * 0.3; // experience
    attrs[key] = clampAttr(value);
  }

  const player = { id, name, age, pos, alt: null, attrs, potential: 0 };

  // About a third can also play the neighbouring line.
  if (pos !== 'GK' && rng.chance(0.35)) {
    const options = pos === 'DEF' ? ['MID'] : pos === 'ATT' ? ['MID'] : ['DEF', 'ATT'];
    player.alt = rng.pick(options);
  }

  // Hidden ceiling for his natural-position rating. Young players have room to
  // grow; from the mid-twenties a player is roughly what he will be.
  const current = overall(player);
  const room = Math.max(0, 25 - age) * (0.25 + rng.next() * 0.75) + rng.next() * 0.8;
  player.potential = Math.round(Math.min(20, current + room) * 10) / 10;

  return player;
}
