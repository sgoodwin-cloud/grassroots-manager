// Grassroots Manager: the screens. All game rules live in game.js and the
// engine files; this file only draws things and reacts to taps.
// Bump APP_VERSION together with VERSION in sw.js on every release.
const APP_VERSION = '2';

import {
  newGame, openGame, userClub, userDivision, userLineup, setFormation, autoPick, selectPlayer,
  lineupStrength, clubQuality, userFixtures, nextFixture, playRound, seasonOver, table, positionOf,
  topTen, squadStats, playerStats, summary, squad, roundResults, shortName, positionRating,
  FORMATIONS, ROUNDS, startMatch, finishRound, userSide, setTactic, lineupProblems, missing,
} from './game.js';
import { stepMinute, substitute, replaceInjured, setTactics, playerRating, currentRate, MAX_SUBS } from './match.js';
import { TACTIC_LABELS } from './team.js';
import { describe } from './commentary.js';
import { generateWorld } from './world.js';
import { overall, attributeBand, familiarity, OUTFIELD_ATTRS, GK_ATTRS, ATTR_LABELS } from './player.js';
import { SLOTS, listSlots, loadSave, writeSave, deleteSave, loadLive, writeLive, persistent } from './store.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');

const state = {
  screen: 'loading', // start | new | game
  slots: [null, null, null],
  slot: null,
  g: null,
  tab: 'home',
  sub: null, // team | report | live
  live: null, // the match being watched: { m, mine, feed, paused, reason, speed, pending, done }
  sheet: null,
  division: 3,
  tableView: 'table',
  statSort: { key: 'rating', dir: -1 },
  report: null, // { result, fresh, side }
  ng: null, // new-game form
};

// ---------- Small helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const ratingBand = (r) => (r >= 8 ? 'excellent' : r >= 7 ? 'good' : r >= 6 ? 'average' : 'poor');
const chip = (r, digits = 1) => `<span class="rating band-${ratingBand(r)}">${r.toFixed(digits)}</span>`;
const formChips = (form) => (form.length ? `<span class="form">${form.map((r) => chip(r)).join('')}</span>` : '<span class="muted small">No games yet</span>');
const ROLE_NAMES = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', ATT: 'Attacker' };
const clubName = (id) => state.g.clubs.get(id).name;
const TACTIC_NAMES = { pressing: 'Pressing', line: 'Defensive line', tempo: 'Tempo' };
const TACTIC_HELP = {
  pressing: 'Pressing high wins the ball more often, but tires the team, leaves gaps and gives away more fouls.',
  line: 'A high line squeezes midfield but is exposed by quick attackers. A deep line protects the goal and blunts your attack.',
  tempo: 'A fast tempo gets more shots away, less accurately, and is tiring. A slow tempo keeps the ball.',
};
/** "Suspended" or "Injured, 2 rounds" for a player who can't play the next match, else ''. */
function outText(playerId) {
  const out = missing(state.g, state.g.players.get(playerId).clubId).get(playerId);
  if (!out) return '';
  return out.reason === 'suspended' ? 'Suspended' : `Injured, ${out.rounds} round${out.rounds > 1 ? 's' : ''}`;
}
const outTag = (playerId) => { const t = outText(playerId); return t ? ` <span class="out">${t}</span>` : ''; };
const playerName = (id) => state.g.players.get(id).name;
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function randomCode() {
  // No look-alikes (O/0, I/1). Only picks the world; nothing in a match uses this.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return [...values].map((v) => letters[v % letters.length]).join('');
}

/** W, D or L for a club in a result. */
function outcome(result, clubId) {
  const mine = result.homeId === clubId ? result.homeGoals : result.awayGoals;
  const theirs = result.homeId === clubId ? result.awayGoals : result.homeGoals;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
}

/** A club's last five results, oldest first, as W/D/L squares. */
function clubForm(clubId) {
  const g = state.g;
  const d = g.clubs.get(clubId).divisionIndex;
  const letters = g.save.results
    .filter((r) => r.divisionIndex === d && (r.homeId === clubId || r.awayId === clubId))
    .slice(-5)
    .map((r) => outcome(r, clubId));
  return letters.length ? `<span class="wdl">${letters.map((l) => `<i class="${l}">${l}</i>`).join('')}</span>` : '';
}

async function persist() {
  const g = state.g;
  try {
    await writeSave(state.slot, g.save, summary(g));
  } catch (err) {
    console.error('Could not save', err);
  }
}

// ---------- Start menu ----------

function viewStart() {
  const cards = SLOTS.map((slot, i) => {
    const s = state.slots[i];
    if (!s) {
      return `<div class="card slot"><div class="eyebrow">Save ${slot}</div><h2>Empty</h2>
        <button class="btn quiet" data-action="new-game" data-slot="${slot}">New game</button></div>`;
    }
    const where = s.round >= s.rounds ? `Season complete, finished ${ordinal(s.position)}` : `Round ${s.round + 1} of ${s.rounds}, ${ordinal(s.position)}`;
    return `<div class="card slot"><div class="eyebrow">Save ${slot}</div><h2>${esc(s.clubName)}</h2>
      <div class="meta">${esc(s.divisionName)} · ${where}<br>Last played ${fmtDate(s.updatedAt)}</div>
      <div class="row"><button class="btn" data-action="continue" data-slot="${slot}">Continue</button>
      <button class="btn quiet" style="flex:0 0 auto" data-action="ask-delete" data-slot="${slot}">Delete</button></div></div>`;
  }).join('');
  return `<div class="screen start">
    <header class="hero"><div class="crest">GM</div><h1>Grassroots Manager</h1>
    <p class="muted">Take a club from the bottom of the Sussex pyramid.</p></header>
    ${cards}
    ${persistent ? '' : '<p class="note">Saves can’t be stored in this window, so a game here lasts until you close it.</p>'}
    <div class="ver">v${APP_VERSION}</div></div>`;
}

// ---------- New game ----------

function startNewGameForm(slot, seed = randomCode()) {
  const world = generateWorld(seed);
  const clubs = world.divisions[3].clubIds
    .map((id) => ({ club: world.clubs.find((c) => c.id === id), quality: clubQuality(world, id) }))
    .sort((a, b) => b.quality - a.quality);
  state.ng = { slot, seed, clubs, choice: state.ng?.choice === 'custom' ? 'custom' : null, name: state.ng?.name || '', error: '' };
  state.screen = 'new';
}

function viewNew() {
  const ng = state.ng;
  const level = (i) => (i < 4 ? ['Easier', 'easy'] : i < 8 ? ['Medium', 'medium'] : ['Hard', 'hard']);
  const rows = ng.clubs.map(({ club, quality }, i) => `<button class="pick ${ng.choice === club.id ? 'is-on' : ''}" data-action="choose-club" data-club="${club.id}">
      <span class="grow">${esc(club.name)}</span><span class="level ${level(i)[1]}">${level(i)[0]}</span><b class="num">${quality.toFixed(1)}</b></button>`).join('');
  return `<header class="topbar"><button class="icon-btn" data-action="to-start">Back</button>
      <div class="titles"><div class="club">New game</div><div class="sub">Save ${ng.slot} · Division Three</div></div></header>
    <div class="screen">
      <div class="card"><div class="eyebrow">World</div>
        <div class="code"><strong>${esc(ng.seed)}</strong><span class="muted small" style="flex:1">Every world has 48 different clubs.</span>
        <button class="btn quiet small-btn" data-action="new-world">New world</button></div></div>
      <div class="section-title">Pick a club. The number is its team rating: the weakest clubs here usually finish near the bottom, and there is no way to strengthen a squad yet.</div>
      <div class="picks">${rows}</div>
      <div class="card"><div class="eyebrow">Or create your own club</div>
        <input class="field" id="club-name" maxlength="24" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Club name" value="${esc(ng.name)}">
        <p class="note">It takes the place of a mid-table club (the sixth strongest here) and keeps that club’s squad.</p></div>
      <div class="sticky-foot">${ng.error ? `<div class="error">${esc(ng.error)}</div>` : ''}
        <button class="btn" data-action="start-game">Start</button></div>
    </div>`;
}

async function startGame() {
  const ng = state.ng;
  const name = ng.name.trim();
  let options;
  if (ng.choice === 'custom' || (!ng.choice && name)) {
    if (name.length < 3) return fail('Give your club a name of at least three letters.');
    if (ng.clubs.some(({ club }) => club.name.toLowerCase() === name.toLowerCase())) return fail('That name is already taken in this world.');
    options = { seed: ng.seed, customClubName: name };
  } else if (ng.choice) {
    options = { seed: ng.seed, clubId: ng.choice };
  } else {
    return fail('Pick a club, or type a name for your own.');
  }
  state.g = openGame(newGame(options));
  state.slot = ng.slot;
  await persist();
  await enterGame();
  function fail(message) { ng.error = message; render(); }
}

async function enterGame() {
  state.screen = 'game';
  state.tab = 'home';
  state.sub = null;
  state.sheet = null;
  state.live = null;
  state.division = userDivision(state.g);
  state.tableView = 'table';
  state.ng = null;
  // Pick up a match that was being watched when the app was last closed.
  try {
    const saved = await loadLive(state.slot);
    if (saved && saved.round === state.g.save.round && !seasonOver(state.g)) {
      const m = saved.m;
      state.live = { m, mine: userSide(state.g, m), feed: saved.feed || [], paused: true, reason: 'Match paused', speed: saved.speed || 1, pending: saved.pending || null, done: m.finished };
      state.sub = 'live';
    } else if (saved) {
      await writeLive(state.slot, null);
    }
  } catch (err) { /* no saved match */ }
  render();
}

// ---------- Game shell ----------

function viewGame() {
  const g = state.g;
  if (state.sub === 'team') return viewTeam();
  if (state.sub === 'report') return viewReport();
  if (state.sub === 'live') return viewLive();
  const s = summary(g);
  const tabs = [['home', 'Home'], ['squad', 'Squad'], ['fixtures', 'Fixtures'], ['table', 'Table'], ['stats', 'Stats']];
  const body = { home: viewHome, squad: viewSquad, fixtures: viewFixtures, table: viewTable, stats: viewStats }[state.tab]();
  return `<header class="topbar"><div class="titles"><div class="club">${esc(s.clubName)}</div>
      <div class="sub">${esc(s.divisionName)} · ${seasonOver(g) ? 'Season complete' : `Round ${s.round + 1} of ${ROUNDS}`}</div></div>
      <button class="icon-btn" data-action="menu">Menu</button></header>
    <main class="screen">${body}</main>
    <nav class="tabbar">${tabs.map(([id, label]) => `<button class="tab ${state.tab === id ? 'is-on' : ''}" data-action="tab" data-tab="${id}">${label}</button>`).join('')}</nav>`;
}

// ---------- Home ----------

function standingCard(s) {
  return `<div class="card"><div class="eyebrow">Your season</div>
    <div class="standing"><div><b>${s.played ? ordinal(s.position) : '–'}</b><span>Place</span></div><div><b>${s.won}</b><span>Won</span></div>
    <div><b>${s.drawn}</b><span>Drawn</span></div><div><b>${s.lost}</b><span>Lost</span></div><div><b>${s.points}</b><span>Points</span></div></div></div>`;
}

function resultLine(f) {
  const g = state.g;
  const r = f.result;
  const o = outcome(r, g.save.userClubId);
  return `<button class="result-btn" data-action="open-report" data-round="${f.round}">
    <span class="wdl"><i class="${o}">${o}</i></span>
    <span class="grow"><b>${esc(clubName(f.opponentId))}</b><br><span class="muted small">Round ${f.round} · ${f.atHome ? 'Home' : 'Away'}</span></span>
    <span class="score">${f.atHome ? r.homeGoals : r.awayGoals}–${f.atHome ? r.awayGoals : r.homeGoals}</span><span class="chev">›</span></button>`;
}

function viewHome() {
  const g = state.g;
  const s = summary(g);
  const fixtures = userFixtures(g);
  const last = fixtures[g.save.round - 1];
  const next = nextFixture(g);
  let top;
  if (next) {
    const oppPlace = s.played ? `${ordinal(positionOf(g, next.opponentId))} in the table` : 'No games played yet';
    top = `<div class="card next"><div class="eyebrow">Round ${next.round} of ${ROUNDS}</div>
      <div><span class="tag ${next.atHome ? '' : 'away'}">${next.atHome ? 'HOME' : 'AWAY'}</span></div>
      <div class="opponent">${esc(clubName(next.opponentId))}</div>
      <div class="line"><span>${oppPlace}</span>${clubForm(next.opponentId)}</div>
      ${lineupProblems(g).map((p) => `<div class="error">${esc(p.player.name)} is ${p.reason} and can’t play. Pick a replacement.</div>`).join('')}
      <button class="btn quiet" data-action="team">Team selection</button>
      <div class="row"><button class="btn" data-action="watch">Watch match</button><button class="btn quiet" data-action="play">Skip to result</button></div></div>`;
  } else {
    const stats = squadStats(g).filter((x) => x.stats.apps > 0);
    const scorer = stats.slice().sort((a, b) => b.stats.goals - a.stats.goals)[0];
    const best = stats.filter((x) => x.stats.apps >= 11).sort((a, b) => b.stats.rating - a.stats.rating)[0];
    const promoted = s.position <= 2;
    top = `<div class="card next"><div class="eyebrow">Season complete</div>
      <div class="opponent">You finished ${ordinal(s.position)}</div>
      <p>${promoted ? 'That is a promotion place.' : s.position >= 11 ? 'A hard season at the bottom of the pyramid.' : 'Not enough for promotion this time.'}
      ${scorer ? ` Top scorer: ${esc(scorer.player.name)} with ${scorer.stats.goals}.` : ''}${best ? ` Best player: ${esc(best.player.name)}, averaging ${best.stats.rating.toFixed(2)}.` : ''}</p>
      <p class="note">Promotion, relegation and the next season arrive in a later update. This save will carry on from here.</p></div>`;
  }
  return `${top}${standingCard(s)}${last ? `<div class="card"><div class="eyebrow">Last match</div>${resultLine(last)}</div>` : ''}`;
}

// ---------- Team selection ----------

function viewTeam() {
  const g = state.g;
  const lineup = userLineup(g);
  const rows = lineup.players.map(({ player, role }, index) => {
    const fam = familiarity(player, role);
    const stats = playerStats(g, player.id);
    const out = outText(player.id);
    const note = out ? `<small>${out}</small>` : fam === 'natural' ? '' : `<small class="${fam === 'accomplished' ? 'ok' : ''}">${fam === 'accomplished' ? 'can play here' : `out of position (${player.pos})`}</small>`;
    return `<button class="slotrow ${out ? 'is-out' : ''}" data-action="slot" data-index="${index}">
      <span class="role">${role}</span>
      <span class="who">${esc(shortName(player.name))}${note}</span>
      <span>${stats.form.length ? chip(stats.form.reduce((a, b) => a + b, 0) / stats.form.length) : ''}</span>
      <span class="val">${positionRating(player, role).toFixed(1)}</span></button>`;
  }).join('');
  const picked = new Set(lineup.players.map((x) => x.player.id));
  const bench = squad(g, g.save.userClubId).filter((p) => !picked.has(p.id))
    .sort((a, b) => (outText(a.id) ? 1 : 0) - (outText(b.id) ? 1 : 0) || overall(b) - overall(a))
    .map((p) => `<button class="slotrow bench" data-action="player" data-player="${p.id}">
      <span class="role">${p.pos}</span><span class="who">${esc(shortName(p.name))}${outText(p.id) ? `<small>${outText(p.id)}</small>` : ''}</span><span></span><span class="val">${overall(p).toFixed(1)}</span></button>`).join('');
  const t = g.save.lineup.tactics;
  const changed = ['pressing', 'line', 'tempo'].filter((k) => t[k] !== 0).length;
  return `<header class="topbar"><button class="icon-btn" data-action="close-sub">Back</button>
      <div class="titles"><div class="club">Team selection</div><div class="sub">Tap a player to change him</div></div></header>
    <main class="screen">
      <div class="chips">${Object.keys(FORMATIONS).map((f) => `<button class="chip ${lineup.formation === f ? 'is-on' : ''}" data-action="formation" data-formation="${f}">${f}</button>`).join('')}</div>
      <div class="teamlist">${rows}</div>
      <div class="row"><button class="btn quiet small-btn" data-action="tactics">Tactics${changed ? ` (${changed} changed)` : ''}</button><button class="btn quiet small-btn" data-action="auto-pick">Auto-pick</button></div>
      ${seasonOver(g) ? '' : '<div class="row"><button class="btn" data-action="watch">Watch match</button><button class="btn quiet" data-action="play">Skip to result</button></div>'}
      <p class="note">The number on the right is how good the player is in that position. The coloured number is his average rating over his last five games. Changing formation picks the best eleven for it.</p>
      <div class="section-title">Not in the team</div>
      <div class="teamlist">${bench}</div>
    </main>`;
}

function tacticControls(tactics, action) {
  return ['pressing', 'line', 'tempo'].map((key) => `<div class="card"><div class="eyebrow">${TACTIC_NAMES[key]}</div>
      <div class="seg three">${[-1, 0, 1].map((v) => `<button class="${tactics[key] === v ? 'is-on' : ''}" data-action="${action}" data-key="${key}" data-value="${v}">${TACTIC_LABELS[key][v + 1]}</button>`).join('')}</div>
      <p class="note">${TACTIC_HELP[key]}</p></div>`).join('');
}

function sheetTactics() {
  const strength = lineupStrength(state.g);
  return sheet('Tactics', `${tacticControls(state.g.save.lineup.tactics, 'set-tactic')}
    <div class="strength"><div><b>${strength.gk.toFixed(1)}</b><span>Keeper</span></div><div><b>${strength.def.toFixed(1)}</b><span>Defence</span></div>
      <div><b>${strength.mid.toFixed(1)}</b><span>Midfield</span></div><div><b>${strength.att.toFixed(1)}</b><span>Attack</span></div></div>
    <p class="note">Your eleven before tactics. You can change tactics again during a match you are watching.</p>`);
}

function sheetProblems() {
  const list = lineupProblems(state.g).map((p) => `<p><b>${esc(p.player.name)}</b> is ${p.reason}${p.reason === 'injured' ? ` for ${p.rounds} more round${p.rounds > 1 ? 's' : ''}` : ' for this match'}.</p>`).join('');
  return sheet('Change your team first', `${list}<div class="row"><button class="btn quiet" data-action="fix-auto">Auto-pick</button><button class="btn" data-action="fix-team">Team selection</button></div>`);
}

function sheetPick(index) {
  const g = state.g;
  const lineup = userLineup(g);
  const slot = lineup.players[index];
  const inTeam = new Map(lineup.players.map((x, i) => [x.player.id, { role: x.role, index: i }]));
  const rows = squad(g, g.save.userClubId)
    .map((p) => ({ p, value: positionRating(p, slot.role) }))
    .sort((a, b) => b.value - a.value)
    .map(({ p, value }) => {
      const at = inTeam.get(p.id);
      const stats = playerStats(g, p.id);
      const out = outText(p.id);
      const where = out || (at ? (at.index === index ? 'Playing here now' : `In the team at ${at.role}`) : 'Not in the team');
      return `<button class="slotrow ${at && at.index === index ? 'is-current' : ''} ${out ? 'is-out' : ''}" ${out && !(at && at.index === index) ? 'disabled' : ''} data-action="pick-player" data-index="${index}" data-player="${p.id}">
        <span class="role">${p.pos}</span>
        <span class="who">${esc(shortName(p.name))}<small class="${out ? '' : 'ok'}">${where}</small></span>
        <span>${stats.form.length ? chip(stats.form.reduce((a, b) => a + b, 0) / stats.form.length) : ''}</span>
        <span class="val">${value.toFixed(1)}</span></button>`;
    }).join('');
  return sheet(`Choose a ${ROLE_NAMES[slot.role].toLowerCase()}`, `<p class="note">Sorted by how good each player is at ${slot.role}. Picking someone already in the team swaps the two.</p><div class="teamlist">${rows}</div>`);
}

// ---------- Squad ----------

function attrTable(groups, attrs) {
  const head = attrs.map((a) => `<th class="a">${ATTR_LABELS[a].slice(0, 3)}</th>`).join('');
  const body = groups.map(([title, players]) => `<tr class="group"><td colspan="${attrs.length + 2}">${title}</td></tr>` + players.map((p) => `<tr class="tap" data-action="player" data-player="${p.id}"><td class="name">${esc(shortName(p.name))}${outText(p.id) ? ` <span class="out">${outText(p.id).startsWith('S') ? 'SUS' : 'INJ'}</span>` : ''}</td>
      ${attrs.map((a) => `<td class="a band-${attributeBand(p.attrs[a])}">${p.attrs[a]}</td>`).join('')}<td class="num ovr">${overall(p).toFixed(1)}</td></tr>`).join('')).join('');
  return `<div class="tablecard"><table class="attrs"><thead><tr><th>Player</th>${head}<th class="num">Ovr</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function viewSquad() {
  const g = state.g;
  const all = squad(g, g.save.userClubId);
  const group = (pos) => all.filter((p) => p.pos === pos).sort((a, b) => overall(b) - overall(a));
  return `<button class="btn quiet" data-action="team">Team selection</button>
    ${attrTable([['Defenders', group('DEF')], ['Midfielders', group('MID')], ['Attackers', group('ATT')]], OUTFIELD_ATTRS)}
    ${attrTable([['Goalkeepers', group('GK')]], GK_ATTRS)}
    <p class="note">Attributes run from 1 to 20: <span class="rating band-poor">1–5</span> <span class="rating band-average">6–10</span> <span class="rating band-good">11–15</span> <span class="rating band-excellent">16–20</span>. Ovr is how good a player is in his own position. Tap a player for more.</p>`;
}

function sheetPlayer(playerId) {
  const g = state.g;
  const p = g.players.get(playerId);
  const stats = playerStats(g, playerId);
  const attrs = p.pos === 'GK' ? GK_ATTRS : OUTFIELD_ATTRS;
  return sheet(p.name, `
    <p class="muted">${ROLE_NAMES[p.pos]}${p.alt ? `, can also play ${ROLE_NAMES[p.alt].toLowerCase()}` : ''} · Age ${p.age} · Overall ${overall(p).toFixed(1)}</p>
    ${outText(playerId) ? `<p class="error">${outText(playerId)}</p>` : ''}
    <div class="card"><div class="eyebrow">Attributes</div><div class="attrgrid">${attrs.map((a) => `<div><span>${ATTR_LABELS[a]}</span><span class="rating band-${attributeBand(p.attrs[a])}">${p.attrs[a]}</span></div>`).join('')}</div></div>
    <div class="card"><div class="eyebrow">This season</div>
      <div class="facts"><div><b>${stats.apps}</b><span>Games</span></div><div><b>${stats.goals}</b><span>Goals</span></div><div><b>${stats.assists}</b><span>Assists</span></div>
      <div><b>${stats.rated ? stats.rating.toFixed(2) : '–'}</b><span>Average rating</span></div><div><b>${stats.rated ? stats.best.toFixed(1) : '–'}</b><span>Best rating</span></div><div><b>${stats.potm}</b><span>Player of the match</span></div></div>
      <div><span class="muted small">Last five: </span>${formChips(stats.form)}</div>
      <p class="note">${stats.starts} start${stats.starts === 1 ? '' : 's'}, ${stats.apps - stats.starts} as a substitute. Cards: ${stats.yellows} yellow, ${stats.reds} red.</p></div>`);
}

// ---------- Fixtures ----------

function viewFixtures() {
  const g = state.g;
  const rows = userFixtures(g).map((f) => {
    if (f.result) return `<div class="card" style="padding:10px 14px">${resultLine(f)}</div>`;
    const isNext = f.round === g.save.round + 1;
    return `<div class="card" style="padding:10px 14px;${isNext ? 'border-color:var(--pitch)' : ''}"><div class="result-btn">
      <span class="tag ${f.atHome ? '' : 'away'}">${f.atHome ? 'H' : 'A'}</span>
      <span class="grow"><b>${esc(clubName(f.opponentId))}</b><br><span class="muted small">Round ${f.round}${isNext ? ' · Next match' : ''}</span></span></div></div>`;
  }).join('');
  return rows;
}

// ---------- Table and top tens ----------

function viewTable() {
  const g = state.g;
  const d = state.division;
  const views = [['table', 'Table'], ['goals', 'Goals'], ['assists', 'Assists'], ['rating', 'Ratings']];
  const divisionChips = g.world.divisions.map((x) => `<button class="chip ${x.index === d ? 'is-on' : ''}" data-action="division" data-division="${x.index}">${x.name.replace('Division', 'Div')}</button>`).join('');
  const viewChips = views.map(([id, label]) => `<button class="chip ${state.tableView === id ? 'is-on' : ''}" data-action="table-view" data-view="${id}">${label}</button>`).join('');
  let body;
  if (state.tableView === 'table') {
    const rows = table(g, d).map((row, i) => `<tr class="${row.clubId === g.save.userClubId ? 'is-me' : ''}"><td class="num muted">${i + 1}</td><td class="name">${esc(row.name)}</td>
      <td class="num">${row.played}</td><td class="num">${row.won}</td><td class="num">${row.drawn}</td><td class="num">${row.lost}</td><td class="num">${row.gd > 0 ? '+' : ''}${row.gd}</td><td class="num"><b>${row.points}</b></td></tr>`).join('');
    body = `<div class="tablecard"><table><thead><tr><th class="num">#</th><th>Club</th><th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th><th class="num">GD</th><th class="num">Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else {
    const key = state.tableView;
    const list = topTen(g, d, key);
    const rows = list.map((t, i) => `<tr class="tap ${t.clubId === g.save.userClubId ? 'is-me' : ''}" data-action="player" data-player="${t.id}"><td class="num muted">${i + 1}</td>
      <td class="name">${esc(playerName(t.id))}<br><span class="muted small" style="font-weight:400">${esc(clubName(t.clubId))} · ${t.apps} games</span></td>
      <td class="num">${key === 'rating' ? chip(t.rating, 2) : `<b style="font:700 18px var(--display)">${t[key]}</b>`}</td></tr>`).join('');
    const notes = { goals: 'Top scorers', assists: 'Most assists', rating: 'Best average rating. Players need to have played in at least half the rounds so far.' };
    body = list.length
      ? `<div class="tablecard"><table class="tall"><tbody>${rows}</tbody></table></div><p class="note">${notes[key]}</p>`
      : '<div class="empty">Nothing to show until the first round has been played.</div>';
  }
  return `<div class="chips">${divisionChips}</div><div class="chips">${viewChips}</div>${body}`;
}

// ---------- Stats ----------

const STAT_COLUMNS = [['apps', 'Gms'], ['goals', 'Gls'], ['assists', 'Ast'], ['rating', 'Avg'], ['potm', 'PoM']];

function viewStats() {
  const g = state.g;
  const { key, dir } = state.statSort;
  const rows = squadStats(g)
    .sort((a, b) => dir * (a.stats[key] - b.stats[key]) || b.stats.apps - a.stats.apps || overall(b.player) - overall(a.player))
    .map(({ player, stats }) => `<tr class="tap" data-action="player" data-player="${player.id}"><td class="name" style="font-weight:600">${esc(shortName(player.name))}</td><td class="muted">${player.pos}</td>
      <td class="num">${stats.apps}</td><td class="num">${stats.goals}</td><td class="num">${stats.assists}</td><td class="num">${stats.rated ? chip(stats.rating, 2) : '–'}</td><td class="num">${stats.potm}</td></tr>`).join('');
  const head = STAT_COLUMNS.map(([k, label]) => `<th class="num"><button data-action="sort" data-key="${k}" style="background:none;border:0;padding:6px 0;font:inherit;color:${key === k ? 'var(--pitch)' : 'inherit'}">${label}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');
  return `<div class="tablecard"><table><thead><tr><th>Player</th><th>Pos</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Games, goals, assists, average rating and player-of-the-match awards this season. Tap a heading to sort, or a player for more.</p>`;
}

// ---------- Match report ----------

function viewReport() {
  const g = state.g;
  const { result: r, fresh } = state.report;
  const me = g.save.userClubId;
  const mySide = r.homeId === me ? 0 : 1;
  const side = state.report.side ?? mySide;
  const o = outcome(r, me);
  const goals = r.goals.map((goal) => {
    const text = `${esc(shortName(playerName(goal.playerId)))}${goal.assistId ? ` <span class="muted">(${esc(shortName(playerName(goal.assistId)))})</span>` : ''}`;
    return `<li><span class="h">${goal.side === 0 ? text : ''}</span><span class="min">${goal.minute}'</span><span>${goal.side === 1 ? text : ''}</span></li>`;
  }).join('');
  const stats = [['Possession', `${r.stats[0].possession}%`, `${r.stats[1].possession}%`], ['Shots', r.stats[0].shots, r.stats[1].shots], ['On target', r.stats[0].onTarget, r.stats[1].onTarget]]
    .map(([k, a, b]) => `<div class="statrow"><span>${a}</span><span class="muted">${k}</span><span>${b}</span></div>`).join('');
  const lines = r.players[side].map((line) => {
    const did = [line.g ? `${line.g} goal${line.g > 1 ? 's' : ''}` : '', line.a ? `${line.a} assist${line.a > 1 ? 's' : ''}` : '', line.sv ? `${line.sv} save${line.sv > 1 ? 's' : ''}` : '',
      line.sub ? `on ${line.sub}'` : '', line.inj ? `injured ${line.off}'` : line.off && !line.rc ? `off ${line.off}'` : ''].filter(Boolean).join(', ');
    const cards = `${line.yc ? '<i class="card-y" title="Booked"></i>' : ''}${line.rc ? '<i class="card-r" title="Sent off"></i>' : ''}`;
    return `<tr class="tap ${line.sub ? 'is-sub' : ''}" data-action="player" data-player="${line.id}"><td class="muted" style="width:38px">${line.sub ? 'SUB' : line.role}</td>
      <td class="name">${esc(shortName(playerName(line.id)))}${cards}${line.id === r.potm ? ' <span class="potm">★</span>' : ''}</td><td class="did">${did}</td><td class="num" style="width:44px">${line.min >= 15 || line.g ? chip(line.rating) : '<span class="muted">–</span>'}</td></tr>`;
  }).join('');
  const others = roundResults(g, r.divisionIndex, r.round).filter((x) => x !== r)
    .map((x) => `<div><span class="h">${esc(clubName(x.homeId))}</span><b>${x.homeGoals}–${x.awayGoals}</b><span>${esc(clubName(x.awayId))}</span></div>`).join('');
  const potmSide = r.players[0].some((line) => line.id === r.potm) ? r.homeId : r.awayId;
  return `<header class="topbar"><button class="icon-btn" data-action="close-sub">${fresh ? 'Done' : 'Back'}</button>
      <div class="titles"><div class="club">Round ${r.round}</div><div class="sub">${esc(g.world.divisions[r.divisionIndex].name)}</div></div></header>
    <main class="screen">
      <div class="card"><div class="outcome ${o}">${{ W: 'Won', D: 'Drew', L: 'Lost' }[o]}</div>
        <div class="scoreline"><span class="home">${esc(clubName(r.homeId))}</span><span class="score">${r.homeGoals}–${r.awayGoals}</span><span>${esc(clubName(r.awayId))}</span></div>
        ${goals ? `<ul class="goals">${goals}</ul>` : ''}
        <div>${stats}</div>
        <p class="small muted" style="text-align:center"><span class="potm">★</span> Player of the match: ${esc(playerName(r.potm))} (${esc(clubName(potmSide))})</p></div>
      <div class="seg"><button class="${side === 0 ? 'is-on' : ''}" data-action="report-side" data-side="0">${esc(clubName(r.homeId))}</button><button class="${side === 1 ? 'is-on' : ''}" data-action="report-side" data-side="1">${esc(clubName(r.awayId))}</button></div>
      <div class="tablecard"><table class="ratings"><tbody>${lines}</tbody></table></div>
      <div class="card"><div class="eyebrow">Other results</div><div class="others">${others}</div></div>
      ${fresh ? '<button class="btn" data-action="close-sub">Continue</button>' : ''}
    </main>`;
}

// ---------- Watching a match ----------

const SPEEDS = { 1: 700, 2: 350, 4: 140 }; // milliseconds per match minute
let ticker = null;

function liveNames() {
  const { m } = state.live;
  return { player: (id) => shortName(playerName(id)), club: (side) => m.teams[side].name };
}

function addFeed(minute, text, kind = '') {
  state.live.feed.unshift({ minute, text, kind });
  if (state.live.feed.length > 120) state.live.feed.length = 120;
}

function beginLive() {
  const g = state.g;
  const m = startMatch(g, 'user');
  if (!m) return false;
  state.live = { m, mine: userSide(g, m), feed: [], paused: false, reason: null, speed: 1, pending: null, done: false };
  addFeed(0, `Kick-off: ${m.teams[0].name} v ${m.teams[1].name}.`, 'mark');
  state.sub = 'live';
  state.sheet = null;
  render();
  schedule();
  return true;
}

function schedule() {
  clearTimeout(ticker);
  const live = state.live;
  if (!live || live.paused || live.done || state.sub !== 'live') return;
  ticker = setTimeout(tick, SPEEDS[live.speed]);
}

function pauseLive(reason) {
  const live = state.live;
  if (!live) return;
  live.paused = true;
  live.reason = reason;
  clearTimeout(ticker);
  saveLive();
}

function saveLive() {
  const live = state.live;
  if (!live || state.slot == null) return;
  writeLive(state.slot, { round: state.g.save.round, m: live.m, feed: live.feed.slice(0, 40), speed: live.speed, pending: live.pending }).catch(() => {});
}

function tick() {
  const live = state.live;
  if (!live || live.paused || live.done) return;
  const { m, mine } = live;
  const names = liveNames();
  let stop = null;
  for (const e of stepMinute(m)) {
    const text = describe(e, names);
    if (text) addFeed(e.minute, text, e.type === 'goal' ? 'goal' : e.type === 'red' ? 'red' : '');
    if (e.type === 'goal' && e.side !== mine) stop = stop || `${m.teams[e.side].name} have scored`;
    if (e.type === 'red' && e.side === mine) stop = `${names.player(e.playerId)} has been sent off`;
    if (e.type === 'injury' && e.side === mine) {
      stop = `${names.player(e.playerId)} is injured`;
      if (e.needsSub) live.pending = { playerId: e.playerId, role: e.role };
    }
  }
  if (m.minute === 45) {
    addFeed(45, `Half-time: ${m.teams[0].name} ${m.score[0]}–${m.score[1]} ${m.teams[1].name}.`, 'mark');
    stop = stop || 'Half-time';
  }
  if (m.finished) {
    addFeed(90, `Full time: ${m.teams[0].name} ${m.score[0]}–${m.score[1]} ${m.teams[1].name}.`, 'mark');
    live.done = true;
    live.paused = true;
    live.reason = 'Full time';
    saveLive();
  } else if (stop) {
    pauseLive(stop);
    if (live.pending) state.sheet = { type: 'changes' };
  } else if (m.minute % 10 === 0) {
    saveLive();
  }
  render();
  schedule();
}

async function finishLive() {
  const live = state.live;
  if (!live || !live.m.finished) return;
  const result = finishRound(state.g, live.m);
  await persist();
  await writeLive(state.slot, null).catch(() => {});
  state.live = null;
  state.sub = 'report';
  state.report = { result, fresh: true };
  render();
}

function viewLive() {
  const live = state.live;
  const { m, mine } = live;
  const feed = live.feed.map((f) => `<li class="${f.kind}"><span class="min">${f.minute ? `${f.minute}'` : ''}</span><span>${esc(f.text)}</span></li>`).join('');
  const controls = live.done
    ? '<button class="btn" data-action="live-finish">See the report</button>'
    : `<div class="row"><button class="btn ${live.paused ? '' : 'quiet'}" data-action="live-toggle">${live.paused ? (m.minute ? 'Resume' : 'Kick off') : 'Pause'}</button>
        <button class="btn quiet" data-action="live-changes">Changes</button></div>
      <div class="live-speed"><span class="muted small">Speed</span>${[1, 2, 4].map((v) => `<button class="chip ${live.speed === v ? 'is-on' : ''}" data-action="live-speed" data-speed="${v}">${v}×</button>`).join('')}
        <button class="chip" data-action="live-skip" style="margin-left:auto">Skip to the end</button></div>`;
  const short = m.teams[mine].eleven.length < 11 ? `<div class="error">You are down to ${m.teams[mine].eleven.length} players.</div>` : '';
  return `<header class="topbar live-top">
      <div class="scoreline"><span class="home">${esc(m.teams[0].name)}</span><span class="score">${m.score[0]}–${m.score[1]}</span><span>${esc(m.teams[1].name)}</span></div>
      <div class="clock">${live.done ? 'Full time' : `${m.minute}'`}</div></header>
    <div class="live-panel">
      ${live.paused && live.reason ? `<div class="live-reason">${esc(live.reason)}</div>` : ''}${short}
      ${controls}
      <div class="live-stats"><span>${m.minute ? Math.round((m.stats[0].possession / m.minute) * 100) : 50}%</span><span class="muted">Possession</span><span>${m.minute ? 100 - Math.round((m.stats[0].possession / m.minute) * 100) : 50}%</span>
        <span>${m.stats[0].shots} (${m.stats[0].onTarget})</span><span class="muted">Shots (on target)</span><span>${m.stats[1].shots} (${m.stats[1].onTarget})</span></div>
    </div>
    <main class="screen feed-screen"><ul class="feed">${feed}</ul></main>`;
}

function sheetChanges(s) {
  const live = state.live;
  const { m, mine } = live;
  const team = m.teams[mine];
  const benchRow = (p, role, action) => `<button class="slotrow" data-action="${action}" data-player="${p.id}">
      <span class="role">${p.pos}</span><span class="who">${esc(shortName(p.name))}</span><span></span><span class="val">${positionRating(p, role).toFixed(1)}</span></button>`;
  const byRole = (role) => team.bench.slice().sort((a, b) => positionRating(b, role) - positionRating(a, role));

  // An injured player has gone off: choose who replaces him.
  if (live.pending) {
    const { playerId, role } = live.pending;
    return sheet(`Replace ${shortName(playerName(playerId))}`, `<p class="note">He was playing at ${role}. The number is how good each substitute is there. You have ${team.subsLeft} substitution${team.subsLeft === 1 ? '' : 's'} left.</p>
      <div class="teamlist">${byRole(role).map((p) => benchRow(p, role, 'live-replace')).join('')}</div>
      <button class="btn quiet" data-action="live-play-short">Carry on a player short</button>`);
  }
  // Choosing who comes on for a player.
  if (s.off) {
    const entry = team.eleven.find((x) => x.player.id === s.off);
    return sheet(`Take off ${shortName(entry.player.name)}`, `<p class="note">Choose who comes on at ${entry.role}. The number is how good each substitute is there.</p>
      <div class="teamlist">${byRole(entry.role).map((p) => benchRow(p, entry.role, 'live-sub-on')).join('')}</div>
      <button class="btn quiet" data-action="live-sub-cancel">Back</button>`);
  }
  const rows = team.eleven.map((x) => `<button class="slotrow live-row" ${team.subsLeft ? '' : 'disabled'} data-action="live-sub-off" data-player="${x.player.id}">
      <span class="role">${x.role}</span>
      <span class="who">${esc(shortName(x.player.name))}${x.yellow ? '<i class="card-y" title="Booked"></i>' : ''}<span class="energy"><i style="width:${Math.round(x.energy * 100)}%" class="${x.energy < 0.6 ? 'low' : ''}"></i></span></span>
      <span>${chip(playerRating(m, mine, x))}</span><span class="val">${currentRate(x).toFixed(1)}</span></button>`).join('');
  return sheet('Changes', `<div class="section-title">Substitutions: ${team.subsLeft} of ${MAX_SUBS} left. Tap a player to take him off.</div>
    <div class="teamlist">${rows}</div>
    <p class="note">The bar is energy. The coloured number is his rating in this match; the number on the right is how well he is playing now, tiredness included.</p>
    ${tacticControls(team.tactics, 'live-tactic')}`);
}

// ---------- Sheets ----------

function sheet(title, body) {
  return `<div class="sheet" role="dialog" aria-label="${esc(title)}"><div class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-close" data-action="close-sheet">Close</button></div><div class="sheet-body">${body}</div></div>`;
}

function sheetMenu() {
  const s = summary(state.g);
  return sheet('Menu', `<button class="btn quiet" data-action="to-start">Back to the start menu</button>
    <p class="note">Your game is saved after every match. World ${esc(s.worldCode)} · Save ${state.slot} · v${APP_VERSION}</p>`);
}

function sheetDelete(slot) {
  const s = state.slots[slot - 1];
  return sheet('Delete this save?', `<p>${esc(s.clubName)}, ${esc(s.divisionName)}. This can’t be undone.</p>
    <div class="row"><button class="btn quiet" data-action="close-sheet">Keep it</button><button class="btn danger" data-action="delete" data-slot="${slot}">Delete</button></div>`);
}

function renderSheet() {
  const s = state.sheet;
  let html = '';
  if (s?.type === 'pick') html = sheetPick(s.index);
  else if (s?.type === 'player') html = sheetPlayer(s.playerId);
  else if (s?.type === 'menu') html = sheetMenu();
  else if (s?.type === 'delete') html = sheetDelete(s.slot);
  else if (s?.type === 'tactics') html = sheetTactics();
  else if (s?.type === 'problems') html = sheetProblems();
  else if (s?.type === 'changes') html = sheetChanges(s);
  $sheet.innerHTML = html;
  $sheet.hidden = !html;
}

// ---------- Render and events ----------

function render() {
  const html = state.screen === 'start' ? viewStart() : state.screen === 'new' ? viewNew() : state.screen === 'game' ? viewGame() : '';
  if (html) $app.innerHTML = html;
  renderSheet();
}

async function showStart() {
  state.slots = await listSlots();
  state.screen = 'start';
  state.g = null;
  state.slot = null;
  state.sub = null;
  state.live = null;
  state.sheet = null;
  render();
}

let busy = false;
const actions = {
  'new-game': (el) => { state.ng = null; startNewGameForm(Number(el.dataset.slot)); render(); },
  'new-world': () => { startNewGameForm(state.ng.slot); render(); },
  'choose-club': (el) => { state.ng.choice = el.dataset.club; state.ng.error = ''; render(); },
  'start-game': () => startGame(),
  'to-start': () => { clearTimeout(ticker); if (state.live && !state.live.done) pauseLive('Match paused'); return showStart(); },
  continue: async (el) => {
    const slot = Number(el.dataset.slot);
    const save = await loadSave(slot);
    if (!save) return showStart();
    state.g = openGame(save);
    state.slot = slot;
    await enterGame();
  },
  'ask-delete': (el) => { state.sheet = { type: 'delete', slot: Number(el.dataset.slot) }; renderSheet(); },
  delete: async (el) => { await deleteSave(Number(el.dataset.slot)); await showStart(); },
  tab: (el) => { state.tab = el.dataset.tab; render(); },
  menu: () => { state.sheet = { type: 'menu' }; renderSheet(); },
  team: () => { state.sub = 'team'; render(); },
  tactics: () => { state.sheet = { type: 'tactics' }; renderSheet(); },
  'set-tactic': async (el) => { setTactic(state.g, el.dataset.key, Number(el.dataset.value)); renderSheet(); render(); await persist(); },
  'fix-team': () => { state.sheet = null; state.sub = 'team'; render(); },
  'fix-auto': async () => { autoPick(state.g); state.sheet = null; render(); await persist(); },
  watch: () => {
    if (lineupProblems(state.g).length) { state.sheet = { type: 'problems' }; renderSheet(); return; }
    beginLive();
  },
  'live-toggle': () => {
    const live = state.live;
    if (live.paused) { live.paused = false; live.reason = null; render(); schedule(); } else { pauseLive('Paused'); render(); }
  },
  'live-speed': (el) => { state.live.speed = Number(el.dataset.speed); render(); schedule(); },
  'live-changes': () => { if (!state.live.paused) pauseLive('Paused'); state.sheet = { type: 'changes' }; render(); },
  'live-tactic': (el) => { setTactics(state.live.m, state.live.mine, { [el.dataset.key]: Number(el.dataset.value) }); saveLive(); renderSheet(); },
  'live-sub-off': (el) => { state.sheet = { type: 'changes', off: el.dataset.player }; renderSheet(); },
  'live-sub-cancel': () => { state.sheet = { type: 'changes' }; renderSheet(); },
  'live-sub-on': (el) => {
    const live = state.live;
    const event = substitute(live.m, live.mine, state.sheet.off, el.dataset.player);
    if (event) addFeed(live.m.minute, describe(event, liveNames()));
    state.sheet = { type: 'changes' };
    saveLive();
    render();
  },
  'live-replace': (el) => {
    const live = state.live;
    const event = replaceInjured(live.m, live.mine, el.dataset.player, live.pending.role);
    if (event) addFeed(live.m.minute, describe(event, liveNames()));
    live.pending = null;
    state.sheet = { type: 'changes' };
    saveLive();
    render();
  },
  'live-play-short': () => { state.live.pending = null; state.sheet = null; saveLive(); render(); },
  'live-skip': async () => {
    const live = state.live;
    clearTimeout(ticker);
    // Your assistant takes over the substitutions for the rest of the match.
    live.pending = null;
    live.m.teams[live.mine].manager = 'ai-subs';
    while (!live.m.finished) stepMinute(live.m);
    await finishLive();
  },
  'live-finish': () => finishLive(),
  'close-sub': () => { state.sub = null; state.report = null; render(); },
  'close-sheet': () => {
    // An injured player still needs replacing: closing the sheet leaves the choice open.
    state.sheet = null;
    renderSheet();
  },
  formation: async (el) => { setFormation(state.g, el.dataset.formation); render(); await persist(); },
  'auto-pick': async () => { autoPick(state.g); render(); await persist(); },
  slot: (el) => { state.sheet = { type: 'pick', index: Number(el.dataset.index) }; renderSheet(); },
  'pick-player': async (el) => {
    selectPlayer(state.g, Number(el.dataset.index), el.dataset.player);
    state.sheet = null;
    render();
    await persist();
  },
  player: (el) => { state.sheet = { type: 'player', playerId: el.dataset.player }; renderSheet(); },
  play: async () => {
    if (lineupProblems(state.g).length) { state.sheet = { type: 'problems' }; renderSheet(); return; }
    const result = playRound(state.g);
    if (!result) return;
    await persist();
    state.sub = 'report';
    state.report = { result, fresh: true };
    render();
  },
  'open-report': (el) => {
    const f = userFixtures(state.g)[Number(el.dataset.round) - 1];
    if (!f.result) return;
    state.sub = 'report';
    state.report = { result: f.result, fresh: false };
    render();
  },
  'report-side': (el) => { state.report.side = Number(el.dataset.side); render(); },
  division: (el) => { state.division = Number(el.dataset.division); render(); },
  'table-view': (el) => { state.tableView = el.dataset.view; render(); },
  sort: (el) => {
    const key = el.dataset.key;
    state.statSort = { key, dir: state.statSort.key === key ? -state.statSort.dir : -1 };
    render();
  },
};

document.addEventListener('click', async (event) => {
  // Tapping the dimmed area behind a sheet closes it.
  if (event.target === $sheet) { state.sheet = null; renderSheet(); return; }
  const el = event.target.closest('[data-action]');
  if (!el || busy) return;
  const action = actions[el.dataset.action];
  if (!action) return;
  busy = true;
  try { await action(el); } finally { busy = false; }
});

// Leaving the app mid-match pauses it and saves where it had got to.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.live && !state.live.paused && !state.live.done) {
    pauseLive('Match paused');
    render();
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'club-name' && state.ng) {
    state.ng.name = event.target.value;
    state.ng.choice = event.target.value.trim() ? 'custom' : null;
    // Update the selection without redrawing, so the keyboard stays up.
    document.querySelectorAll('.pick.is-on').forEach((el) => el.classList.remove('is-on'));
  }
});

showStart();

// ---------- Offline support and the update bar (pattern proven in Pocket Factory, Flip 7 and Qwixx Score) ----------
if ('serviceWorker' in navigator) {
  (async () => {
    try {
      // Only reload on a controller change if a worker was already running (an update), never on first install.
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('sw.js');
      const btn = document.getElementById('update');
      let reloading = false;
      const reload = () => { if (!reloading) { reloading = true; location.reload(); } };
      // Tap, tell the waiting worker to take over, reload once it has actually switched on.
      const show = (w) => {
        btn.hidden = false;
        document.body.classList.add('has-update');
        btn.onclick = () => {
          const nw = reg.waiting || w;
          btn.textContent = 'Updating…';
          btn.disabled = true;
          if (!nw || nw.state === 'activated') return reload();
          nw.addEventListener('statechange', () => { if (nw.state === 'activated') reload(); });
          nw.postMessage('skipWaiting');
          setTimeout(reload, 5000);
        };
      };
      // Catch an update whatever stage it's at: already waiting, mid-download, or found later.
      const track = (w) => {
        if (!w) return;
        const check = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) show(w); };
        check();
        w.addEventListener('statechange', check);
      };
      track(reg.waiting);
      track(reg.installing);
      reg.addEventListener('updatefound', () => track(reg.installing));
      reg.update().catch(() => {});
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reload(); });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    } catch (err) { /* no service worker (e.g. an artifact preview): the game still works */ }
  })();
}
