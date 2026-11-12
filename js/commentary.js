// Turns match events into lines of commentary. No randomness: the wording is
// picked from the minute and the player, so a match always reads the same.

const LINES = {
  goal: [
    'GOAL! {p} scores for {club}{assist}.',
    'GOAL for {club}! {p} finds the net{assist}.',
    'GOAL! {p} puts it away{assist}. {club} celebrate.',
    'GOAL! A fine finish from {p}{assist}.',
  ],
  save: [
    '{p} shoots, and the keeper saves.',
    'Good stop! {p}’s effort is kept out.',
    '{p} tests the keeper, who holds on.',
    '{p} gets a shot away but it’s straight at the keeper.',
  ],
  miss: [
    '{p} shoots wide.',
    '{p} drags his shot off target.',
    '{p} blazes it over the bar.',
    'A chance for {club}, but {p} can’t keep it down.',
  ],
  tackle: [
    '{p} wins the ball back for {club}.',
    'Good tackle by {p}.',
    '{p} steps in and breaks up the attack.',
    '{club} clear their lines through {p}.',
  ],
  yellow: ['{p} ({club}) is booked.', 'Yellow card for {p} of {club}.'],
  red: ['RED CARD! {p} ({club}) is sent off{second}.'],
  injury: ['{p} ({club}) is hurt and has to come off.', '{p} goes down injured. He can’t continue for {club}.'],
};

function pick(list, event) {
  let n = event.minute;
  for (const ch of event.playerId || '') n += ch.charCodeAt(0);
  return list[n % list.length];
}

/**
 * One line for an event, or null if it isn't worth a line (some tackles).
 * names: { player(id), club(side) }.
 */
export function describe(event, names) {
  if (event.type === 'sub') {
    const on = names.player(event.playerId);
    return event.offId
      ? `Substitution for ${names.club(event.side)}: ${on} replaces ${names.player(event.offId)}.`
      : `Substitution for ${names.club(event.side)}: ${on} comes on.`;
  }
  // Only some tackles get a mention, or the feed is nothing else.
  if (event.type === 'tackle' && event.minute % 3 !== 0) return null;
  const list = LINES[event.type];
  if (!list) return null;
  return pick(list, event)
    .replace('{p}', names.player(event.playerId))
    .replace('{club}', names.club(event.side))
    .replace('{assist}', event.assistId ? `, set up by ${names.player(event.assistId)}` : '')
    .replace('{second}', event.second ? ' for a second booking' : '');
}
