// Match engine: 90 one-minute ticks.
//
// Each minute one side has the ball (a contest between the midfields). The side
// with the ball may get a shot away (attack against defence); a shot may be on
// target (shooter against defence) and then may go in (shooter against keeper).
//
// Everything works on the gap in rating points between the two teams, so a
// side that is one point better has the same edge in any division.
//
// A match can be run in one go (simulateMatch) or a minute at a time
// (createMatch + stepMinute) for the live commentary in M3. The state holds
// the random-number state, so a paused match resumes exactly.

import { hashSeed, makeRng } from './rng.js';
import { teamStrength } from './team.js';

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
  assistChance: 0.7,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Who tends to take the shots, and who tends to make them.
const SHOT_ROLE_WEIGHT = { GK: 0, DEF: 0.3, MID: 1, ATT: 3 };
const ASSIST_ROLE_WEIGHT = { GK: 0.05, DEF: 0.5, MID: 2, ATT: 1.2 };

const attr = (player, key) => player.attrs[key] ?? 3;

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
    return { clubId: side.clubId, name: side.name, lineup: side.lineup, strength };
  });
  return {
    minute: 0,
    finished: false,
    rngState: hashSeed('match', seed),
    score: [0, 0],
    teams,
    stats: [
      { possession: 0, shots: 0, onTarget: 0 },
      { possession: 0, shots: 0, onTarget: 0 },
    ],
    events: [],
  };
}

/** Play one minute. Returns the events from that minute (often none). */
export function stepMinute(state) {
  if (state.finished) return [];
  const rng = makeRng(state.rngState);
  const minute = ++state.minute;
  const happened = [];

  const [home, away] = state.teams;
  const homeBall = 1 / (1 + Math.exp(-TUNING.possessionK * (home.strength.mid - away.strength.mid)));
  const side = rng.next() < homeBall ? 0 : 1;
  const team = state.teams[side];
  const opp = state.teams[1 - side];
  state.stats[side].possession++;

  const shotChance = clamp(
    TUNING.shotBase * Math.exp(TUNING.shotK * (team.strength.att - opp.strength.def)),
    0.03,
    0.65,
  );

  if (rng.next() < shotChance) {
    const eleven = team.lineup.players;
    const shooter = rng.weighted(
      eleven,
      eleven.map((x) => SHOT_ROLE_WEIGHT[x.role] * (attr(x.player, 'finishing') + 2)),
    ).player;
    const skill = 0.7 * attr(shooter, 'finishing') + 0.3 * attr(shooter, 'technique');
    state.stats[side].shots++;

    const onTargetChance = clamp(
      TUNING.onTargetBase * Math.exp(TUNING.onTargetK * (skill - opp.strength.def)),
      0.08,
      0.75,
    );

    let type = 'miss';
    let assistId = null;
    if (rng.next() < onTargetChance) {
      state.stats[side].onTarget++;
      const goalChance = clamp(
        TUNING.goalBase * Math.exp(TUNING.goalK * (skill - opp.strength.gk)),
        0.06,
        0.75,
      );
      if (rng.next() < goalChance) {
        type = 'goal';
        state.score[side]++;
        if (rng.next() < TUNING.assistChance) {
          const others = eleven.filter((x) => x.player !== shooter);
          assistId = rng.weighted(
            others,
            others.map((x) => ASSIST_ROLE_WEIGHT[x.role] * (attr(x.player, 'passing') + 2)),
          ).player.id;
        }
      } else {
        type = 'save';
      }
    }
    const event = { minute, side, type, playerId: shooter.id, assistId };
    state.events.push(event);
    happened.push(event);
  }

  state.rngState = rng.state;
  if (minute >= MATCH_MINUTES) state.finished = true;
  return happened;
}

/** What gets kept once a match is over: the score, the goals and the headline stats. */
export function matchResult(state) {
  const minutes = state.minute || 1;
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
  };
}

/** Run a whole match in one go. */
export function simulateMatch(setup) {
  const state = createMatch(setup);
  while (!state.finished) stepMinute(state);
  return { ...matchResult(state), events: state.events };
}
