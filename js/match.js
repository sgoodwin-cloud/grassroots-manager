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
// stats are built from. Better players are more likely to be the one who did
// the good thing and less likely to be the one who made the mistake.
//
// A match can be run in one go (simulateMatch) or a minute at a time
// (createMatch + stepMinute) for the live commentary in M3. The state holds
// the random-number states, so a paused match resumes exactly.

import { hashSeed, makeRng } from './rng.js';
import { teamStrength } from './team.js';
import { positionRating } from './player.js';

export const MATCH_MINUTES = 90;

// Calibrated in tools/calibrate.js against the design-doc targets:
// about 2.5-3 goals a game, home wins about 45%, draws about 25%.
export const TUNING = {
  possessionK: 0.16, // how sharply a better midfield wins the ball, per rating point
  homeAdvantage: 0.95, // rating points added to the home side's midfield and attack
  shotBase: 0.24, // chance of a shot per minute on the ball, even teams
  shotK: 0.07,
  onTargetBase: 0.36, // chance a shot is on target, even teams
  onTargetK: 0.02,
  goalBase: 0.297, // chance an on-target shot beats the keeper, even teams
  goalK: 0.04,
  keyPassChance: 0.7, // share of shots that a team-mate set up
  stopChance: 0.4, // share of shot-less minutes that end with a tackle or interception
};

// Player ratings, on Football Manager's 1.0-10.0 scale. Everyone starts at
// `start` and moves with what he does. Calibrated so the average is about 6.8
// and no position is favoured (see tools/calibrate.js).
export const RATING = {
  start: 6.6,
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
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Who tends to be involved in what.
const SHOT_ROLE_WEIGHT = { GK: 0, DEF: 0.3, MID: 1, ATT: 3 };
const ASSIST_ROLE_WEIGHT = { GK: 0.05, DEF: 0.5, MID: 2, ATT: 1.2 };
const TOUCH_ROLE_WEIGHT = { GK: 0.1, DEF: 1, MID: 3, ATT: 1 };
const TACKLE_ROLE_WEIGHT = { GK: 0, DEF: 3, MID: 1.2, ATT: 0.15 };
const GIVEAWAY_ROLE_WEIGHT = { GK: 0, DEF: 0.3, MID: 1.5, ATT: 1.5 };

const attr = (player, key) => player.attrs[key] ?? 3;

const newLine = (player, role) => ({
  id: player.id, role, min: 0, delta: 0, g: 0, a: 0, sh: 0, sot: 0, kp: 0, tk: 0, sv: 0,
});

/**
 * Set up a match. home and away are { clubId, name, lineup } where lineup comes
 * from pickXI / bestLineup. seed: any number or string.
 */
export function createMatch({ home, away, seed }) {
  const teams = [home, away].map((side, index) => {
    const strength = teamStrength(side.lineup);
    if (index === 0) {
      strength.mid += TUNING.homeAdvantage;
      strength.att += TUNING.homeAdvantage;
    }
    // One entry per player on the pitch: who he is, where he's playing, how
    // good he is there, and his running stat line.
    const eleven = side.lineup.players.map(({ player, role }) => ({
      player,
      role,
      rate: positionRating(player, role),
      line: newLine(player, role),
    }));
    return { clubId: side.clubId, name: side.name, formation: side.lineup.formation, strength, eleven };
  });
  return {
    minute: 0,
    finished: false,
    // Two streams: one decides what happens, the other who did it. Changing
    // how credit is shared out can then never change a scoreline.
    rngState: hashSeed('match', seed),
    creditRngState: hashSeed('credit', seed),
    score: [0, 0],
    teams,
    stats: [
      { possession: 0, shots: 0, onTarget: 0 },
      { possession: 0, shots: 0, onTarget: 0 },
    ],
    events: [],
  };
}

/**
 * Play one minute. Returns everything that happened in it, for commentary:
 * shots ('goal', 'save', 'miss') and smaller moments ('tackle'). Only the
 * shots are kept in state.events.
 */
export function stepMinute(state) {
  if (state.finished) return [];
  const rng = makeRng(state.rngState);
  const credit = makeRng(state.creditRngState);
  const minute = ++state.minute;
  const happened = [];

  const [home, away] = state.teams;
  const homeBall = 1 / (1 + Math.exp(-TUNING.possessionK * (home.strength.mid - away.strength.mid)));
  const side = rng.next() < homeBall ? 0 : 1;
  const team = state.teams[side];
  const opp = state.teams[1 - side];
  state.stats[side].possession++;

  for (const t of state.teams) for (const x of t.eleven) x.line.min = minute;

  // Someone on the side with the ball won it or kept it.
  const onBall = credit.weighted(
    team.eleven,
    team.eleven.map((x) => TOUCH_ROLE_WEIGHT[x.role] * x.rate * x.rate),
  );
  onBall.line.delta += RATING.touch;

  const shotChance = clamp(
    TUNING.shotBase * Math.exp(TUNING.shotK * (team.strength.att - opp.strength.def)),
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
    const skill = 0.7 * attr(shooter, 'finishing') + 0.3 * attr(shooter, 'technique');
    state.stats[side].shots++;
    taker.line.sh++;

    // Most shots come from a team-mate's pass.
    let maker = null;
    if (credit.next() < TUNING.keyPassChance) {
      const others = eleven.filter((x) => x !== taker);
      maker = credit.weighted(
        others,
        others.map((x) => ASSIST_ROLE_WEIGHT[x.role] * (attr(x.player, 'passing') + 2)),
      );
      maker.line.kp++;
      maker.line.delta += RATING.keyPass;
    }

    const onTargetChance = clamp(
      TUNING.onTargetBase * Math.exp(TUNING.onTargetK * (skill - opp.strength.def)),
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
    const event = { minute, side, type, playerId: shooter.id, assistId };
    state.events.push(event);
    happened.push(event);
  } else if (credit.next() < TUNING.stopChance) {
    // The attack broke down because somebody on the other side stopped it.
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
    happened.push({ minute, side: 1 - side, type: 'tackle', playerId: stopper.player.id, fromId: loser.player.id });
  }

  state.rngState = rng.state;
  state.creditRngState = credit.state;
  if (minute >= MATCH_MINUTES) state.finished = true;
  return happened;
}

/**
 * A player's rating so far, 1.0-10.0 to one decimal place. Once the match is
 * over it includes the result and any clean sheet.
 */
export function playerRating(state, side, entry) {
  let value = RATING.start + entry.line.delta;
  if (state.finished) {
    const mine = state.score[side];
    const theirs = state.score[1 - side];
    if (mine > theirs) value += RATING.win;
    else if (mine < theirs) value += RATING.loss;
    if (theirs === 0) value += RATING.cleanSheet[entry.role];
  }
  return Math.round(clamp(value, 1, 10) * 10) / 10;
}

/**
 * What gets kept once a match is over: the score, the goals, the headline
 * stats, and one stat line per player ([home lines, away lines]).
 * Line: { id, role, min, rating, g, a, sh, sot, kp, tk, sv }.
 */
export function matchResult(state) {
  const minutes = state.minute || 1;
  const players = state.teams.map((team, side) =>
    team.eleven.map((entry) => {
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
