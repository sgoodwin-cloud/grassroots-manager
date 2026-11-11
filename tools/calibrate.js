// Run with: node tools/calibrate.js [worlds]
// Simulates many seasons and prints how the engine compares with the targets.

import { measure, measureDivisionGap, measureFormations, TARGETS, inTarget } from '../js/calibrate.js';

const worlds = Number(process.argv[2] || 30);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const flag = (v, t) => (inTarget(v, t) ? 'ok ' : 'OUT');

const started = Date.now();
const s = measure(worlds);

console.log(`${s.matches} matches across ${worlds} worlds (${Date.now() - started} ms)\n`);
console.log(`${flag(s.goalsPerGame, TARGETS.goalsPerGame)} goals per game   ${s.goalsPerGame.toFixed(2)}   target ${TARGETS.goalsPerGame.join('-')}`);
console.log(`${flag(s.homeWin, TARGETS.homeWin)} home wins        ${pct(s.homeWin)}  target ${TARGETS.homeWin.map(pct).join('-')}`);
console.log(`${flag(s.draw, TARGETS.draw)} draws            ${pct(s.draw)}  target ${TARGETS.draw.map(pct).join('-')}`);
console.log(`    away wins        ${pct(s.awayWin)}`);
console.log(`    shots per team   ${s.shotsPerTeam.toFixed(1)}  (on target ${s.onTargetPerTeam.toFixed(1)})`);
console.log(`    goalless draws   ${pct(s.goallessDraws)}`);
console.log(`    biggest win      ${s.biggestWin.text}`);
console.log(`    champions        ${s.avgChampionPoints.toFixed(1)} pts on average; bottom club ${s.avgBottomPoints.toFixed(1)}`);
console.log(`    strongest squad  won the division ${pct(s.strongestFinishedFirst / s.divisions)}, top three ${pct(s.strongestFinishedTopThree / s.divisions)}`);
console.log(`    weakest squad    finished bottom three ${pct(s.weakestFinishedBottomThree / s.divisions)}`);
const f = s.favourite;
console.log(`    clear favourite  won ${pct(f.won / f.matches)}, drew ${pct(f.drawn / f.matches)}, lost ${pct(f.lost / f.matches)}  (${f.matches} matches, 1.5+ rating gap)`);

console.log('\nplayer ratings:');
console.log(`${flag(s.ratingMean, TARGETS.ratingMean)} average          ${s.ratingMean.toFixed(2)}   target ${TARGETS.ratingMean.join('-')}  (spread ${s.ratingSd.toFixed(2)})`);
console.log(`${s.ratingRoleSpread <= TARGETS.ratingRoleSpread ? 'ok ' : 'OUT'} by position      ${Object.entries(s.ratingByRole).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')}`);
console.log(`    8.0 or more      ${pct(s.ratingHigh)}   under 6.0 ${pct(s.ratingLow)}   10.0 ${pct(s.ratingPerfect)}`);
console.log(`    winners v losers ${s.ratingWinners.toFixed(2)} v ${s.ratingLosers.toFixed(2)}`);
console.log(`    player of match  ${Object.entries(s.potmShare).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`);
console.log(`    season leaders   top scorer ${s.avgTopScorerGoals.toFixed(1)} goals, most assists ${s.avgTopAssists.toFixed(1)}, best average ${s.avgTopRating.toFixed(2)}`);
console.log(`    ability link     ${s.abilityCorrelation.toFixed(2)} (correlation between a player's ability and his season average)`);

console.log('\ngoals in a match:');
s.goalsHistogram.forEach((n, i) => console.log(`  ${i === 8 ? '8+' : ` ${i}`}  ${pct(n / s.matches).padStart(6)}  ${'#'.repeat(Math.round((n / s.matches) * 100))}`));

console.log('\ndivision gap (higher-division club v club from the division below):');
for (const g of measureDivisionGap()) {
  console.log(`  ${g.upper} v ${g.lower}: won ${pct(g.won)}, drew ${pct(g.drawn)}, lost ${pct(g.lost)}`);
}

console.log('\nformation balance (points per game v 4-4-2):');
for (const [formation, ppg] of Object.entries(measureFormations())) {
  console.log(`  ${formation}  ${ppg.toFixed(3)}`);
}
