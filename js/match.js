// Match engine: 90 one-minute ticks.
//
// Each minute one side has the ball (a contest between the midfields). The side
// with the ball may get a shot away (attack against defence); a shot may be on
// target (shooter against defence) and then may go in (shooter against keeper).
//
// Everything works on the gap in rating points between the two teams, so a
// side that is one point better has the same edge in any division.
//
// The odds are decided at team level. Each contest is then pinned on the
// individuals involved (who won the ball, who made the tackle, who was at
// fault for the goal), and that is what the per-match player ratings and
// stats are built from.
//
// Players tire as the match goes on, faster if the team presses or plays at a
// high tempo, and a tired player plays below his rating. Each side has three
// tactical settings and three substitutions. Tackles can bring cards; a red
// card or an injury with no substitutes left means playing a man short.
//
// A match can be run in one go (simulateMatch) or a minute at a time
// (createMatch + stepMinute), with substitute() and setTactics() between
// minutes. The state is plain data and holds the random-number states, so a
// paused match can be saved and resumes exactly.

import { hashSeed, makeRng } from './rng.js';
import { countBonus, DEFAULT_TACTICS } from './team.js';
import { positionRating } from './player.js';

export const MATCH_MINUTES = 90;
export const MAX_SUBS = 3;

// Calibrated in tools/calibrate.js against the design-doc targets:
// about 2.5-3 goals a game, home wins about 45%, draws about 25%.
export const TUNING = {
  possessionK: 0.16, // how sharply a better midfield wins the ball, per rating point
  homeAdvantage: 0.95, // rating points added to the home side's midfield and attack
  shotBase: 0.24, // chance of a shot per minute on the ball, even teams
  shotK: 0.07,
  onTargetBase: 0.36, // chance a shot is on target, even teams
  onTargetK: 0.02,
  goalBase: 0.318, // chance an on-target shot beats the keeper, even teams
  goalK: 0.04,
  keyPassChance: 0.7, // share of shots that a team-mate set up
  stopChance: 0.4, // share of shot-less minutes that end with a tackle or interception

  // Fatigue. Energy runs from 1 (fresh) towards 0. An average player (stamina
  // 10) ends a normal match on about 0.6; a tired player plays below his rating.
  drain: 0.0045, // energy lost per minute at stamina 10
  keeperDrain: 0.35, // keepers tire much less
  fatigueFloor: 0.7, // share of his rating a player keeps with no energy left

  // Tactics. Each setting is -1, 0 or +1; values are rating points unless noted.
  pressMid: 0.5, // pressing wins the ball more often...
  pressDef: 0.3, // ...but leaves gaps behind it...
  pressDrain: 0.3, // ...and tires the team (share of extra drain)
  pressFouls: 0.25, // ...and gives away more fouls
  lineMid: 0.4, // a high line squeezes midfield
  lineHighDef: 0.4, // and is exposed behind...
  linePace: 0.12, // ...unless the defenders are quicker than their attackers (per point of pace)
  lineDeepDef: 0.65, // a deep line protects the goal...
  lineDeepAtt: 0.25, // ...and leaves the attack short of support
  tempoShots: 0.1, // a fast tempo gets more shots away (share)...
  tempoAccuracy: 0.07, // ...that are less accurate (share)...
  tempoDrain: 0.12, // ...and tires the team
  tempoSlowMid: 0.2, // a slow tempo keeps the ball better

  // Incidents.
  yellowChance: 0.1, // per tackle
  secondYellowChance: 0.03, // per tackle by a player already booked
  redChance: 0.002, // straight red, per tackle
  injuryChance: 0.0009, // per team per minute
};

// Player ratings, on Football Manager's 1.0-10.0 scale. Everyone starts at
// `start` and moves with what he does. Calibrated so the average is about 6.8
// and no position is favoured (see tools/calibrate.js).
export const RATING = {
  start: 6.65,
  goal: 1.0,
  assist: 0.5,
  keyPass: 0.06,
  shotOnTarget: 0.12,
  shotOff: -0.1,
  touch: 0.01, // won or kept the ball for a minute
  tackle: 0.1,
  giveaway: -0.12, // lost the ball to that tackle
  save: 0.2,
  concededKeeper: -0.42,
  concededAtFault: -0.4, // the one defender who lost his man
  concededDefender: -0.08, // the rest of the back line
  cleanSheet: { GK: 0.5, DEF: 0.55, MID: 0, ATT: 0 },
  win: 0.15,
  loss: -0.15,
  yellow: -0.2,
  red: -1.5,
  // A substitute needs this long on the pitch for the result and clean sheet to count for him.
  minutesForBonus: 30,
};

// How long an injury keeps a player out, in rounds, and how likely each is.
const INJURY_ROUNDS = [1, 2, 3, 4, 6];
const INJURY_WEIGHTS = [40, 25, 15, 10, 10];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Who tends to be involved in what.
const SHOT_ROLE_WEIGHT = { GK: 0, DEF: 0.3, MID: 1, ATT: 3 };
const ASSIST_ROLE_WEIGHT = { GK: 0.05, DEF: 0.5, MID: 2, ATT: 1.2 };
const TOUCH_ROLE_WEIGHT = { GK: 0.1, DEF: 1, MID: 3, ATT: 1 };
const TACKLE_ROLE_WEIGHT = { GK: 0, DEF: 3, MID: 1.2, ATT: 0.15 };
const GIVEAWAY_ROLE_WEIGHT = { GK: 0, DEF: 0.3, MID: 1.5, ATT: 1.5 };
const INJURY_ROLE_WEIGHT = { GK: 0.3, DEF: 1, MID: 1, ATT: 1 };

const attr = (player, key) => player.attrs[key] ?? 3;
const fatigue = (energy) => TUNING.fatigueFloor + (1 - TUNING.fatigueFloor) * energy;
/** How good a player is right now: his rating in the role, less tiredness. */
export const currentRate = (entry) => entry.rate * fatigue(entry.energy);

const newEntry = (player, role, minute = 0) => ({
  player,
  role,
  rate: positionRating(player, role),
  energy: 1,
  yellow: false,
  line: {
    id: player.id, role, min: 0, delta: 0, g: 0, a: 0, sh: 0, sot: 0, kp: 0, tk: 0, sv: 0,
    ...(minute ? { sub: minute } : {}),
  },
});

/**
 * Set up a match. home and away are:
 *   { clubId, name, lineup, tactics?, manager? }
 * lineup comes from pickXI / bestLineup: { formation, players: [{ player, role }], bench: [player] }.
 * manager: 'ai' (default) makes substitutions and late tactical changes for that side;
 * 'ai-subs' makes substitutions only; 'user' leaves everything to substitute(),
 * replaceInjured() and setTactics(); 'none' does nothing (for testing).
 * seed: any number or string.
 */
export function createMatch({ home, away, seed }) {
  const teams = [home, away].map((side) => ({
    clubId: side.clubId,
    name: side.name,
    formation: side.lineup.formation,
    tactics: { ...DEFAULT_TACTICS, ...(side.tactics || {}) },
    manager: side.manager || 'ai',
    eleven: side.lineup.players.map(({ player, role }) => newEntry(player, role)),
    bench: (side.lineup.bench || []).slice(),
    off: [], // players who have left the pitch, with their stat lines
    subsLeft: MAX_SUBS,
    strength: null,
  }));
  const state = {
    minute: 0,
    finished: false,
    // Three streams: what happens, who did it, and incidents (cards, injuries,
    // AI managers' choices). Changing how credit is shared out can then never
    // change a scoreline.
    rngState: hashSeed('match', seed),
    creditRngState: hashSeed('credit', seed),
    incidentRngState: hashSeed('incident', seed),
    score: [0, 0],
    teams,
    stats: [
      { possession: 0, shots: 0, onTarget: 0 },
      { possession: 0, shots: 0, onTarget: 0 },
    ],
    events: [],
  };
  refreshStrengths(state);
  return state;
}

const meanOf = (group, value) => (group.length ? group.reduce((t, x) => t + value(x), 0) / group.length : 0);

/** Work out each side's keeper, defence, midfield and attack as they stand this minute. */
export function refreshStrengths(state) {
  state.teams.forEach((team, index) => {
    const opp = state.teams[1 - index];
    const unit = (role) => {
      const group = team.eleven.filter((x) => x.role === role);
      return (group.length ? meanOf(group, currentRate) : 1) + countBonus(role, group.length);
    };
    const keeper = team.eleven.find((x) => x.role === 'GK');
    const s = { gk: keeper ? currentRate(keeper) : 1, def: unit('DEF'), mid: unit('MID'), att: unit('ATT') };

    const { pressing, line, tempo } = team.tactics;
    s.mid += TUNING.pressMid * pressing;
    s.def -= TUNING.pressDef * pressing;
    s.mid += TUNING.lineMid * line;
    if (line > 0) {
      const backs = team.eleven.filter((x) => x.role === 'DEF');
      let runners = opp.eleven.filter((x) => x.role === 'ATT');
      if (!runners.length) runners = opp.eleven.filter((x) => x.role === 'MID');
      const gap = meanOf(backs, (x) => attr(x.player, 'pace')) - meanOf(runners, (x) => attr(x.player, 'pace'));
      s.def += clamp(TUNING.linePace * gap, -1, 1) - TUNING.lineHighDef;
    } else if (line < 0) {
      s.def += TUNING.lineDeepDef;
      s.att -= TUNING.lineDeepAtt;
    }
    if (tempo < 0) s.mid += TUNING.tempoSlowMid;

    if (index === 0) {
      s.mid += TUNING.homeAdvantage;
      s.att += TUNING.homeAdvantage;
    }
    team.strength = s;
  });
}

// ---------- Changes during a match ----------

/** Change a side's tactics. Any of pressing, line, tempo; each -1, 0 or +1. */
export function setTactics(state, side, tactics) {
  const team = state.teams[side];
  for (const key of ['pressing', 'line', 'tempo']) {
    if (key in tactics) team.tactics[key] = clamp(Math.round(tactics[key]), -1, 1);
  }
  refreshStrengths(state);
}

/**
 * Bring a player on for another. The newcomer takes the same position.
 * Returns the event, or null if it isn't allowed (no substitutions left, or
 * either player isn't where he should be).
 */
export function substitute(state, side, offId, onId) {
  const team = state.teams[side];
  if (state.finished || team.subsLeft <= 0) return null;
  const index = team.eleven.findIndex((x) => x.player.id === offId);
  const benchIndex = team.bench.findIndex((p) => p.id === onId);
  if (index < 0 || benchIndex < 0) return null;
  const leaving = team.eleven[index];
  const [player] = team.bench.splice(benchIndex, 1);
  leaving.line.off = state.minute;
  team.off.push(leaving);
  team.eleven[index] = newEntry(player, leaving.role, state.minute || 1);
  team.subsLeft--;
  const event = { minute: state.minute, side, type: 'sub', playerId: onId, offId };
  state.events.push(event);
  refreshStrengths(state);
  return event;
}

/** The best player on the bench for a role, or null. */
export function bestReplacement(team, role) {
  let best = null;
  for (const p of team.bench) {
    if (!best || positionRating(p, role) > positionRating(best, role)) best = p;
  }
  return best;
}

/** Take a player off without a replacement (sent off, or injured with no substitutions left). */
function removePlayer(state, side, entry) {
  const team = state.teams[side];
  entry.line.off = state.minute;
  team.eleven.splice(team.eleven.indexOf(entry), 1);
  team.off.push(entry);
  // Nobody in goal: the weakest outfield player goes in.
  if (entry.role === 'GK' && team.eleven.length) {
    let stand = team.eleven[0];
    for (const x of team.eleven) if (x.rate < stand.rate) stand = x;
    stand.role = 'GK';
    stand.rate = positionRating(stand.player, 'GK');
    stand.line.role = 'GK';
  }
}

/** What an AI manager does during the match: fresh legs, and a change of approach late on. */
function manage(state, side) {
  const team = state.teams[side];
  const minute = state.minute;
  if ([60, 70, 80].includes(minute) && team.subsLeft > 0) {
    // Swap whoever gains most from being replaced, if anyone clearly does.
    let best = null;
    for (const entry of team.eleven) {
      const candidate = bestReplacement(team, entry.role);
      if (!candidate) continue;
      const gain = positionRating(candidate, entry.role) - currentRate(entry);
      if (gain > 0.4 && (!best || gain > best.gain)) best = { entry, candidate, gain };
    }
    if (best) substitute(state, side, best.entry.player.id, best.candidate.id);
  }
  if (team.manager === 'ai' && (minute === 65 || minute === 78)) {
    const diff = state.score[side] - state.score[1 - side];
    if (diff < 0) setTactics(state, side, { tempo: 1, pressing: Math.min(1, team.tactics.pressing + 1) });
    else if (diff > 0 && minute === 78) setTactics(state, side, { line: Math.max(-1, team.tactics.line - 1), tempo: -1 });
  }
}

// ---------- One minute ----------

/**
 * Play one minute. Returns everything that happened in it, for commentary:
 * shots ('goal', 'save', 'miss'), 'tackle', 'yellow', 'red', 'injury', 'sub'.
 * Tackles aren't kept in state.events; everything else is.
 */
export function stepMinute(state) {
  if (state.finished) return [];
  const rng = makeRng(state.rngState);
  const credit = makeRng(state.creditRngState);
  const incident = makeRng(state.incidentRngState);
  const minute = ++state.minute;
  const before = state.events.length;
  const tackles = [];

  // Managers act first, on what they can see.
  state.teams.forEach((team, side) => {
    if (team.manager === 'ai' || team.manager === 'ai-subs') manage(state, side);
  });

  const [home, away] = state.teams;
  const homeBall = 1 / (1 + Math.exp(-TUNING.possessionK * (home.strength.mid - away.strength.mid)));
  const side = rng.next() < homeBall ? 0 : 1;
  const team = state.teams[side];
  const opp = state.teams[1 - side];
  state.stats[side].possession++;

  for (const t of state.teams) for (const x of t.eleven) x.line.min++;

  // Someone on the side with the ball won it or kept it.
  const onBall = credit.weighted(
    team.eleven,
    team.eleven.map((x) => TOUCH_ROLE_WEIGHT[x.role] * x.rate * x.rate),
  );
  onBall.line.delta += RATING.touch;

  const shotChance = clamp(
    TUNING.shotBase *
      (1 + TUNING.tempoShots * team.tactics.tempo) *
      Math.exp(TUNING.shotK * (team.strength.att - opp.strength.def)),
    0.03,
    0.65,
  );

  if (rng.next() < shotChance) {
    const eleven = team.eleven;
    const taker = rng.weighted(
      eleven,
      eleven.map((x) => SHOT_ROLE_WEIGHT[x.role] * (attr(x.player, 'finishing') + 2)),
    );
    const shooter = taker.player;
    const skill = (0.7 * attr(shooter, 'finishing') + 0.3 * attr(shooter, 'technique')) * fatigue(taker.energy);
    state.stats[side].shots++;
    taker.line.sh++;

    // Most shots come from a team-mate's pass.
    let maker = null;
    const others = eleven.filter((x) => x !== taker);
    if (others.length && credit.next() < TUNING.keyPassChance) {
      maker = credit.weighted(
        others,
        others.map((x) => ASSIST_ROLE_WEIGHT[x.role] * (attr(x.player, 'passing') + 2)),
      );
      maker.line.kp++;
      maker.line.delta += RATING.keyPass;
    }

    const onTargetChance = clamp(
      TUNING.onTargetBase *
        (1 - TUNING.tempoAccuracy * team.tactics.tempo) *
        Math.exp(TUNING.onTargetK * (skill - opp.strength.def)),
      0.08,
      0.75,
    );

    let type = 'miss';
    let assistId = null;
    if (rng.next() < onTargetChance) {
      state.stats[side].onTarget++;
      taker.line.sot++;
      const keeper = opp.eleven.find((x) => x.role === 'GK');
      const goalChance = clamp(
        TUNING.goalBase * Math.exp(TUNING.goalK * (skill - opp.strength.gk)),
        0.06,
        0.75,
      );
      if (rng.next() < goalChance) {
        type = 'goal';
        state.score[side]++;
        taker.line.g++;
        taker.line.delta += RATING.goal;
        if (maker) {
          assistId = maker.player.id;
          maker.line.a++;
          maker.line.delta += RATING.assist;
        }
        // The goal counts against the keeper and the back line, one defender most of all.
        if (keeper) keeper.line.delta += RATING.concededKeeper;
        const backLine = opp.eleven.filter((x) => x.role === 'DEF');
        if (backLine.length) {
          const atFault = credit.weighted(backLine, backLine.map((x) => 1 / (x.rate * x.rate)));
          for (const x of backLine) {
            x.line.delta += x === atFault ? RATING.concededAtFault : RATING.concededDefender;
          }
        }
      } else {
        type = 'save';
        taker.line.delta += RATING.shotOnTarget;
        if (keeper) {
          keeper.line.sv++;
          keeper.line.delta += RATING.save;
        }
      }
    } else {
      taker.line.delta += RATING.shotOff;
    }
    state.events.push({ minute, side, type, playerId: shooter.id, assistId });
  } else if (credit.next() < TUNING.stopChance) {
    // The attack broke down because somebody on the other side stopped it...
    const stopper = credit.weighted(
      opp.eleven,
      opp.eleven.map((x) => TACKLE_ROLE_WEIGHT[x.role] * x.rate * x.rate),
    );
    stopper.line.tk++;
    stopper.line.delta += RATING.tackle;
    // ...and somebody on the attacking side lost it.
    const loser = credit.weighted(
      team.eleven,
      team.eleven.map((x) => GIVEAWAY_ROLE_WEIGHT[x.role] / (x.rate * x.rate)),
    );
    loser.line.delta += RATING.giveaway;
    tackles.push({ minute, side: 1 - side, type: 'tackle', playerId: stopper.player.id, fromId: loser.player.id });

    // Was it a foul? Pressing teams give away more.
    const fouls = 1 + TUNING.pressFouls * opp.tactics.pressing;
    const roll = incident.next();
    if (roll < (TUNING.redChance + (stopper.yellow ? TUNING.secondYellowChance : 0)) * fouls) {
      stopper.line.rc = 1;
      stopper.line.delta += RATING.red;
      state.events.push({ minute, side: 1 - side, type: 'red', playerId: stopper.player.id, second: stopper.yellow });
      removePlayer(state, 1 - side, stopper);
    } else if (!stopper.yellow && roll < (TUNING.redChance + TUNING.yellowChance) * fouls) {
      stopper.yellow = true;
      stopper.line.yc = 1;
      stopper.line.delta += RATING.yellow;
      state.events.push({ minute, side: 1 - side, type: 'yellow', playerId: stopper.player.id });
    }
  }

  // Injuries. An AI manager replaces the player straight away if he can;
  // otherwise the player goes off and the caller decides (or the side plays short).
  state.teams.forEach((t, s) => {
    if (incident.next() >= TUNING.injuryChance || !t.eleven.length) return;
    const hurt = incident.weighted(t.eleven, t.eleven.map((x) => INJURY_ROLE_WEIGHT[x.role]));
    const out = incident.weighted(INJURY_ROUNDS, INJURY_WEIGHTS);
    hurt.line.inj = out;
    const event = { minute, side: s, type: 'injury', playerId: hurt.player.id, out, role: hurt.role };
    state.events.push(event);
    const replacement = t.subsLeft > 0 ? bestReplacement(t, hurt.role) : null;
    if (t.manager !== 'user' && t.manager !== 'none' && replacement) {
      substitute(state, s, hurt.player.id, replacement.id);
    } else {
      // The user chooses a replacement with replaceInjured(); until then the side is a man down.
      removePlayer(state, s, hurt);
      event.needsSub = t.manager === 'user' && !!replacement;
    }
  });

  // Everyone tires.
  for (const t of state.teams) {
    const effort = 1 + TUNING.pressDrain * t.tactics.pressing + TUNING.tempoDrain * t.tactics.tempo;
    for (const x of t.eleven) {
      const base = TUNING.drain * (1.5 - attr(x.player, 'stamina') / 20) * (x.role === 'GK' ? TUNING.keeperDrain : 1);
      x.energy = Math.max(0, x.energy - base * effort);
    }
  }

  refreshStrengths(state);
  state.rngState = rng.state;
  state.creditRngState = credit.state;
  state.incidentRngState = incident.state;
  if (minute >= MATCH_MINUTES) state.finished = true;
  return [...tackles, ...state.events.slice(before)];
}

/**
 * After an injury took a user's player off, bring a substitute on in his place.
 * role is where the injured player was playing.
 */
export function replaceInjured(state, side, onId, role) {
  const team = state.teams[side];
  if (state.finished || team.subsLeft <= 0) return null;
  const benchIndex = team.bench.findIndex((p) => p.id === onId);
  if (benchIndex < 0) return null;
  // If an outfield player had to go in goal, he goes back to where he was needed least: keep it simple and leave him.
  const [player] = team.bench.splice(benchIndex, 1);
  const keeperless = role === 'GK';
  if (keeperless) {
    // The stand-in keeper returns to the outfield as the new man takes the gloves.
    const stand = team.eleven.find((x) => x.role === 'GK');
    if (stand && stand.player.pos !== 'GK') {
      const back = stand.player.pos;
      stand.role = back;
      stand.rate = positionRating(stand.player, back);
      stand.line.role = back;
    }
  }
  team.eleven.push(newEntry(player, role, state.minute || 1));
  team.subsLeft--;
  const event = { minute: state.minute, side, type: 'sub', playerId: onId, offId: null };
  state.events.push(event);
  refreshStrengths(state);
  return event;
}

// ---------- Results ----------

/**
 * A player's rating so far, 1.0-10.0 to one decimal place. Once the match is
 * over it includes the result and any clean sheet.
 */
export function playerRating(state, side, entry) {
  let value = RATING.start + entry.line.delta;
  if (state.finished && entry.line.min >= RATING.minutesForBonus) {
    const mine = state.score[side];
    const theirs = state.score[1 - side];
    if (mine > theirs) value += RATING.win;
    else if (mine < theirs) value += RATING.loss;
    if (theirs === 0) value += RATING.cleanSheet[entry.line.role];
  }
  return Math.round(clamp(value, 1, 10) * 10) / 10;
}

/**
 * What gets kept once a match is over: the score, the key events, the headline
 * stats, and one stat line per player who took part ([home lines, away lines]).
 * Line: { id, role, min, rating, g, a, sh, sot, kp, tk, sv } plus, when they
 * apply, sub (minute he came on), off (minute he left), yc, rc, inj (rounds out).
 */
export function matchResult(state) {
  const minutes = state.minute || 1;
  const players = state.teams.map((team, side) =>
    [...team.eleven, ...team.off]
      .sort((a, b) => (a.line.sub || 0) - (b.line.sub || 0))
      .map((entry) => {
        const { delta, ...line } = entry.line;
        return { ...line, rating: playerRating(state, side, entry) };
      }),
  );
  // Player of the match: best rating, then most goals, then the winning side.
  const winner = state.score[0] >= state.score[1] ? 0 : 1;
  let best = null;
  players.forEach((lines, side) => {
    for (const line of lines) {
      const better =
        !best ||
        line.rating > best.line.rating ||
        (line.rating === best.line.rating &&
          (line.g > best.line.g || (line.g === best.line.g && side === winner && best.side !== winner)));
      if (better) best = { line, side };
    }
  });
  return {
    homeId: state.teams[0].clubId,
    awayId: state.teams[1].clubId,
    homeGoals: state.score[0],
    awayGoals: state.score[1],
    goals: state.events.filter((e) => e.type === 'goal'),
    incidents: state.events.filter((e) => ['yellow', 'red', 'injury', 'sub'].includes(e.type)),
    stats: state.stats.map((s) => ({
      possession: Math.round((s.possession / minutes) * 100),
      shots: s.shots,
      onTarget: s.onTarget,
    })),
    players,
    potm: best.line.id,
  };
}

/** Run a whole match in one go. */
export function simulateMatch(setup) {
  const state = createMatch(setup);
  while (!state.finished) stepMinute(state);
  return { ...matchResult(state), events: state.events };
}
