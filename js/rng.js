// Seeded random numbers. Everything random in the game goes through here so a
// world or a match can be replayed exactly from its seed.
// The whole state is one unsigned 32-bit integer, so it can be stored in a save.

/** Turn any mix of strings and numbers into a 32-bit seed (FNV-1a). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Final scramble so similar inputs give unrelated seeds.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Make a generator (mulberry32). `rng.state` can be saved and passed back in. */
export function makeRng(seed) {
  const rng = {
    state: seed >>> 0,
    /** Float in [0, 1). */
    next() {
      rng.state = (rng.state + 0x6d2b79f5) >>> 0;
      let t = rng.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** Whole number from lo to hi inclusive. */
    int(lo, hi) {
      return lo + Math.floor(rng.next() * (hi - lo + 1));
    },
    chance(p) {
      return rng.next() < p;
    },
    pick(list) {
      return list[Math.floor(rng.next() * list.length)];
    },
    /** Pick by weight. `weights` lines up with `list`. */
    weighted(list, weights) {
      let total = 0;
      for (const w of weights) total += w;
      let roll = rng.next() * total;
      for (let i = 0; i < list.length; i++) {
        roll -= weights[i];
        if (roll < 0) return list[i];
      }
      return list[list.length - 1];
    },
    /** Bell-curve number (Box-Muller). */
    normal(mean = 0, sd = 1) {
      const u = 1 - rng.next();
      const v = rng.next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    /** Shuffled copy (Fisher-Yates). */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}
