// Player stats. Nothing here is stored: season totals are always worked out
// from the per-match stat lines kept with each result.

/** A player needs this many minutes in a match for his rating to count towards his average. */
export const MIN_MINUTES_RATED = 15;

/**
 * Season totals for every player who appears in `results`.
 * Returns a Map of player id -> totals. `rating` is the average over
 * appearances; `form` is his last five ratings, oldest first.
 */
export function playerTotals(results) {
  const totals = new Map();
  for (const r of results) {
    if (!r.players) continue;
    r.players.forEach((lines, side) => {
      const conceded = side === 0 ? r.awayGoals : r.homeGoals;
      const clubId = side === 0 ? r.homeId : r.awayId;
      for (const line of lines) {
        let t = totals.get(line.id);
        if (!t) {
          t = {
            id: line.id, clubId, apps: 0, minutes: 0, goals: 0, assists: 0, shots: 0, onTarget: 0,
            keyPasses: 0, tackles: 0, saves: 0, cleanSheets: 0, potm: 0, ratingSum: 0, rating: 0,
            best: 0, form: [], starts: 0, rated: 0, yellows: 0, reds: 0,
          };
          totals.set(line.id, t);
        }
        t.apps++;
        if (!line.sub) t.starts++;
        t.yellows += line.yc || 0;
        t.reds += line.rc || 0;
        t.minutes += line.min;
        t.goals += line.g;
        t.assists += line.a;
        t.shots += line.sh;
        t.onTarget += line.sot;
        t.keyPasses += line.kp;
        t.tackles += line.tk;
        t.saves += line.sv;
        if (conceded === 0 && line.min >= 60 && (line.role === 'GK' || line.role === 'DEF')) t.cleanSheets++;
        if (r.potm === line.id) t.potm++;
        // A brief substitute appearance is a game played, but too short to rate.
        if (line.min >= MIN_MINUTES_RATED) {
          t.rated++;
          t.ratingSum += line.rating;
          t.best = Math.max(t.best, line.rating);
          t.form.push(line.rating);
          if (t.form.length > 5) t.form.shift();
        }
      }
    });
  }
  for (const t of totals.values()) t.rating = t.rated ? t.ratingSum / t.rated : 0;
  return totals;
}

/** How many appearances a player needs before his average rating is ranked. */
export function minAppsForRating(results) {
  let rounds = 0;
  for (const r of results) rounds = Math.max(rounds, r.round || 0);
  return Math.max(1, Math.ceil(rounds / 2));
}

/**
 * Top players by 'goals', 'assists' or 'rating'.
 * Average rating only ranks players with at least `minApps` appearances, so
 * one great game can't top the chart.
 */
export function leaders(totals, key, { limit = 10, minApps = 1, nameOf = (id) => id } = {}) {
  let list = [...totals.values()];
  if (key === 'rating') list = list.filter((t) => t.rated >= minApps);
  else list = list.filter((t) => t[key] > 0);
  list.sort((a, b) => {
    if (b[key] !== a[key]) return b[key] - a[key];
    if (key === 'rating') return b.apps - a.apps || nameOf(a.id).localeCompare(nameOf(b.id));
    // Level on goals or assists: fewer games first, then the other stat.
    const other = key === 'goals' ? 'assists' : 'goals';
    return a.apps - b.apps || b[other] - a[other] || nameOf(a.id).localeCompare(nameOf(b.id));
  });
  return list.slice(0, limit);
}
