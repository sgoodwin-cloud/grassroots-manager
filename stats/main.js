// M1 stats page: shows the engine's calibration numbers and lets you poke at a
// generated world. Not part of the game itself.

import { generateWorld, squadOf, clubById } from '../js/world.js';
import { simulateSeason, divisionTable } from '../js/league.js';
import { simulateMatch } from '../js/match.js';
import { bestLineup, teamStrength } from '../js/team.js';
import { overall, attributeBand, OUTFIELD_ATTRS, GK_ATTRS, ATTR_LABELS } from '../js/player.js';
import { measure, TARGETS, inTarget } from '../js/calibrate.js';

const baked = window.__BAKED__;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (v, digits = 1) => `${(v * 100).toFixed(digits)}%`;

// ---------- Calibration ----------

function renderCalibration(stats, label) {
  const tiles = [
    { name: 'Goals per game', value: stats.goalsPerGame.toFixed(2), target: TARGETS.goalsPerGame, raw: stats.goalsPerGame, range: `${TARGETS.goalsPerGame[0]} to ${TARGETS.goalsPerGame[1]}` },
    { name: 'Home wins', value: pct(stats.homeWin), target: TARGETS.homeWin, raw: stats.homeWin, range: `${pct(TARGETS.homeWin[0], 0)} to ${pct(TARGETS.homeWin[1], 0)}` },
    { name: 'Draws', value: pct(stats.draw), target: TARGETS.draw, raw: stats.draw, range: `${pct(TARGETS.draw[0], 0)} to ${pct(TARGETS.draw[1], 0)}` },
  ];
  $('tiles').innerHTML = tiles
    .map((t) => {
      const ok = inTarget(t.raw, t.target);
      return `<div class="tile"><div class="tile-name">${t.name}</div><div class="tile-value">${t.value}</div>
        <div class="tile-foot"><span class="pill ${ok ? 'pill-ok' : 'pill-out'}">${ok ? '✓ On target' : '✕ Off target'}</span><span class="muted">target ${t.range}</span></div></div>`;
    })
    .join('');
  $('sample-note').textContent = `${label}: ${stats.matches.toLocaleString('en-GB')} matches across ${stats.worlds} generated worlds.`;

  const f = stats.favourite;
  const rows = [
    ['Away wins', pct(stats.awayWin)],
    ['Shots per team', `${stats.shotsPerTeam.toFixed(1)} (${stats.onTargetPerTeam.toFixed(1)} on target)`],
    ['Goalless draws', pct(stats.goallessDraws)],
    ['Biggest win', stats.biggestWin.text],
    ['Champions’ points (from 22 games)', stats.avgChampionPoints.toFixed(1)],
    ['Bottom club’s points', stats.avgBottomPoints.toFixed(1)],
    ['Strongest squad won its division', pct(stats.strongestFinishedFirst / stats.divisions, 0)],
    ['Strongest squad finished top three', pct(stats.strongestFinishedTopThree / stats.divisions, 0)],
    ['Clear favourite won / drew / lost', `${pct(f.won / f.matches, 0)} / ${pct(f.drawn / f.matches, 0)} / ${pct(f.lost / f.matches, 0)}`],
  ];
  $('facts').innerHTML = rows.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  renderHistogram(stats);
}

function renderHistogram(stats) {
  const shares = stats.goalsHistogram.map((n) => n / stats.matches);
  const W = 560, H = 220, left = 40, right = 8, top = 12, bottom = 34;
  const plotW = W - left - right, plotH = H - top - bottom;
  const max = Math.ceil(Math.max(...shares) * 20) / 20; // round up to 5%
  const band = plotW / shares.length;
  const barW = Math.min(40, band - 10);
  const y = (v) => top + plotH - (v / max) * plotH;
  let svg = '';
  for (let t = 0; t <= max + 1e-9; t += 0.05) {
    svg += `<line x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}" class="grid"/>`;
    svg += `<text x="${left - 8}" y="${y(t) + 4}" text-anchor="end" class="tick">${Math.round(t * 100)}%</text>`;
  }
  const peak = shares.indexOf(Math.max(...shares));
  shares.forEach((v, i) => {
    const x = left + i * band + (band - barW) / 2;
    const h = Math.max(1, (v / max) * plotH);
    const name = i === 8 ? '8 or more goals' : i === 1 ? '1 goal' : `${i} goals`;
    svg += `<g class="bar" tabindex="0" data-text="${name}: ${pct(v)} of matches">
      <rect x="${left + i * band}" y="${top}" width="${band}" height="${plotH}" fill="transparent"/>
      ${h < 8
        ? `<rect x="${x}" y="${top + plotH - h}" width="${barW}" height="${h}" class="bar-fill"/>`
        : `<path d="M${x} ${top + plotH}V${y(v) + 4}q0 -4 4 -4h${barW - 8}q4 0 4 4V${top + plotH}z" class="bar-fill"/>`}
    </g>`;
    svg += `<text x="${left + i * band + band / 2}" y="${H - 16}" text-anchor="middle" class="tick">${i === 8 ? '8+' : i}</text>`;
  });
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="axis"/>`;
  svg += `<text x="${left + plotW / 2}" y="${H - 1}" text-anchor="middle" class="tick">goals in the match</text>`;
  const chart = $('histogram');
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of matches by number of goals">${svg}</svg>`;
  const readout = $('histogram-readout');
  const bars = [...chart.querySelectorAll('.bar')];
  const show = (bar) => {
    bars.forEach((b) => b.classList.toggle('is-on', b === bar));
    readout.textContent = bar.dataset.text;
  };
  bars.forEach((bar) => {
    for (const type of ['pointerenter', 'focus', 'click']) bar.addEventListener(type, () => show(bar));
  });
  show(bars[peak]);
}

function renderExtras() {
  $('gap').innerHTML = baked.gaps
    .map((g) => `<tr><td>${g.upper} v ${g.lower}</td><td class="num">${pct(g.won, 0)}</td><td class="num">${pct(g.drawn, 0)}</td><td class="num">${pct(g.lost, 0)}</td></tr>`)
    .join('');
  $('formations').innerHTML = Object.entries(baked.formations)
    .map(([name, ppg]) => `<tr><td>${name}</td><td class="num">${ppg.toFixed(2)}</td></tr>`)
    .join('');
}

let liveRuns = 0;
$('run-more').addEventListener('click', () => {
  const button = $('run-more');
  button.disabled = true;
  button.textContent = 'Simulating…';
  setTimeout(() => {
    const started = performance.now();
    const stats = measure(10, `live-${Date.now()}-${liveRuns++}`);
    renderCalibration(stats, `Simulated on this device just now (${Math.round(performance.now() - started)} ms)`);
    button.disabled = false;
    button.textContent = 'Simulate 10 fresh worlds';
  }, 30);
});

// ---------- World ----------

let world, season, selectedDivision = 3, selectedClub = null, matchCount = 0;

function loadWorld(seed) {
  world = generateWorld(seed);
  season = simulateSeason(world, 1);
  selectedDivision = 3;
  selectedClub = world.divisions[3].clubIds[0];
  matchCount = 0;
  $('seed').value = seed;
  renderDivisionTabs();
  renderTable();
  renderSquad();
  playMatch();
}

function renderDivisionTabs() {
  $('division-tabs').innerHTML = world.divisions
    .map((d) => `<button type="button" class="tab ${d.index === selectedDivision ? 'is-on' : ''}" data-division="${d.index}" aria-pressed="${d.index === selectedDivision}">${d.name}</button>`)
    .join('');
}

function renderTable() {
  const table = divisionTable(world, season.results, selectedDivision);
  $('table-body').innerHTML = table
    .map((row, i) => {
      const zone = i < 2 && selectedDivision > 0 ? 'zone-up' : i >= 10 && selectedDivision < 3 ? 'zone-down' : '';
      return `<tr class="${zone} ${row.clubId === selectedClub ? 'is-selected' : ''}">
        <td class="num pos">${i + 1}</td>
        <td><button type="button" class="club-link" data-club="${row.clubId}">${esc(row.name)}</button></td>
        <td class="num">${row.played}</td><td class="num">${row.won}</td><td class="num">${row.drawn}</td><td class="num">${row.lost}</td>
        <td class="num">${row.gf}</td><td class="num">${row.ga}</td><td class="num">${row.gd > 0 ? '+' : ''}${row.gd}</td><td class="num pts">${row.points}</td></tr>`;
    })
    .join('');
}

function attrCell(value) {
  return `<td class="attr band-${attributeBand(value)}">${value}</td>`;
}

function squadTable(players, attrs, caption) {
  const head = attrs.map((a) => `<th class="num" title="${ATTR_LABELS[a]}">${ATTR_LABELS[a].slice(0, 3)}</th>`).join('');
  const body = players
    .map((p) => `<tr><td class="player">${esc(p.name)}</td><td>${p.pos}${p.alt ? `<span class="muted">/${p.alt}</span>` : ''}</td><td class="num">${p.age}</td>
      ${attrs.map((a) => attrCell(p.attrs[a])).join('')}<td class="num ovr">${overall(p).toFixed(1)}</td><td class="num muted">${p.potential.toFixed(1)}</td></tr>`)
    .join('');
  return `<div class="scroll"><table class="squad"><caption>${caption}</caption><thead><tr><th>Player</th><th>Pos</th><th class="num">Age</th>${head}<th class="num">Ovr</th><th class="num" title="Hidden in the game">Pot</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderSquad() {
  const club = clubById(world, selectedClub);
  const squad = squadOf(world, selectedClub);
  const lineup = bestLineup(squad);
  const strength = teamStrength(lineup);
  $('squad-title').textContent = club.name;
  $('squad-note').textContent = `${world.divisions[club.divisionIndex].name}. The AI manager would line up ${lineup.formation}: keeper ${strength.gk.toFixed(1)}, defence ${strength.def.toFixed(1)}, midfield ${strength.mid.toFixed(1)}, attack ${strength.att.toFixed(1)}.`;
  const order = { DEF: 0, MID: 1, ATT: 2 };
  const outfield = squad.filter((p) => p.pos !== 'GK').sort((a, b) => order[a.pos] - order[b.pos] || overall(b) - overall(a));
  $('squad').innerHTML =
    squadTable(outfield, OUTFIELD_ATTRS, 'Outfield players') +
    squadTable(squad.filter((p) => p.pos === 'GK'), GK_ATTRS, 'Goalkeepers');
}

function playMatch() {
  const club = clubById(world, selectedClub);
  const others = world.divisions[club.divisionIndex].clubIds.filter((id) => id !== club.id);
  const opponent = clubById(world, others[matchCount % others.length]);
  const atHome = matchCount % 2 === 0;
  const side = (c) => ({ clubId: c.id, name: c.name, lineup: bestLineup(squadOf(world, c.id)) });
  const home = atHome ? club : opponent;
  const away = atHome ? opponent : club;
  const r = simulateMatch({ home: side(home), away: side(away), seed: `friendly-${world.seed}-${club.id}-${matchCount}` });
  matchCount++;
  const nameOf = (id) => world.players.find((p) => p.id === id).name;
  $('match-score').innerHTML = `<span class="team home">${esc(home.name)}</span><span class="score">${r.homeGoals} – ${r.awayGoals}</span><span class="team">${esc(away.name)}</span>`;
  $('match-stats').innerHTML = [
    ['Possession', `${r.stats[0].possession}%`, `${r.stats[1].possession}%`],
    ['Shots', r.stats[0].shots, r.stats[1].shots],
    ['On target', r.stats[0].onTarget, r.stats[1].onTarget],
  ].map(([k, a, b]) => `<div class="stat-row"><span class="num">${a}</span><span class="muted">${k}</span><span class="num">${b}</span></div>`).join('');
  $('match-goals').innerHTML = r.goals.length
    ? r.goals.map((g) => `<li class="${g.side === 0 ? 'goal-home' : 'goal-away'}"><span class="minute">${g.minute}'</span> <span><strong>${esc(nameOf(g.playerId))}</strong>${g.assistId ? ` <span class="muted">(${esc(nameOf(g.assistId))})</span>` : ''} <span class="muted">for ${esc((g.side === 0 ? home : away).name)}</span></span></li>`).join('')
    : '<li class="muted">No goals.</li>';
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-division]');
  if (tab) {
    selectedDivision = Number(tab.dataset.division);
    renderDivisionTabs();
    renderTable();
    return;
  }
  const link = event.target.closest('[data-club]');
  if (link) {
    selectedClub = link.dataset.club;
    matchCount = 0;
    renderTable();
    renderSquad();
    playMatch();
    $('squad-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
$('world-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadWorld($('seed').value.trim() || 'sussex');
});
$('random-world').addEventListener('click', () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += letters[Math.floor(Math.random() * letters.length)];
  loadWorld(code);
});
$('play-again').addEventListener('click', playMatch);

renderCalibration(baked.stats, 'Measured when this page was built');
renderExtras();
loadWorld('SUSX');
