// Real Sussex towns and villages, plus Brighton & Hove neighbourhoods.
// Club names are "<place> <suffix>" and must never exactly match a real club.
//
// size: 4 = large town, 3 = town, 2 = Brighton & Hove neighbourhood or large
//       village, 1 = village. Bigger places tend to start higher up the pyramid.
// avoid: suffixes a real club in that place already uses (so we never pick them).
// bh: true for Brighton & Hove neighbourhoods.
//
// Almost every real village club is plain "<place> FC", so the bare "FC" suffix
// is never used anywhere.

export const SUFFIXES = ['Town', 'United', 'Athletic', 'Rovers', 'Wanderers', 'Rangers', 'Albion'];

const p = (name, size, avoid = [], bh = false) => ({ name, size, avoid, bh });

export const PLACES = [
  // Large towns
  p('Worthing', 4, ['United', 'Town']),
  p('Eastbourne', 4, ['Town', 'United', 'Athletic', 'Rangers']),
  p('Hastings', 4, ['United', 'Town', 'Rangers']),
  p('Crawley', 4, ['Town', 'United']),
  p('Horsham', 4, ['Athletic']),
  p('Chichester', 4, ['Town', 'United']),
  p('Bognor Regis', 4, ['Town', 'United']),
  p('Burgess Hill', 4, ['Town', 'Albion']),
  p('Haywards Heath', 4, ['Town']),
  p('Littlehampton', 4, ['Town', 'United']),
  p('Lewes', 4),
  p('Bexhill', 4, ['United', 'Town', 'Rovers']),

  // Towns
  p('Shoreham', 3, ['United']),
  p('Seaford', 3, ['Town']),
  p('Newhaven', 3),
  p('Peacehaven', 3, ['Rangers', 'United']),
  p('East Grinstead', 3, ['Town', 'United']),
  p('Uckfield', 3, ['Town', 'United']),
  p('Hailsham', 3, ['Town', 'United']),
  p('Crowborough', 3, ['Athletic']),
  p('Southwick', 3, ['Rangers']),
  p('Lancing', 3, ['United', 'Rangers']),
  p('Rye', 3, ['Town', 'United']),
  p('Battle', 3, ['Town']),
  p('Heathfield', 3, ['United']),
  p('Midhurst', 3),
  p('Petworth', 3),
  p('Arundel', 3),
  p('Steyning', 3, ['Town']),
  p('Storrington', 3),
  p('Billingshurst', 3),
  p('Hassocks', 3),
  p('Henfield', 3),
  p('Selsey', 3),
  p('Polegate', 3, ['Town']),
  p('Rustington', 3),
  p('Pulborough', 3),
  p('Southwater', 3),

  // Brighton & Hove neighbourhoods
  p('Patcham', 2, ['United'], true),
  p('Westdene', 2, [], true),
  p('Hollingbury', 2, [], true),
  p('Fishersgate', 2, [], true),
  p('Hangleton', 2, ['Rangers'], true),
  p('Withdean', 2, [], true),
  p('Woodingdean', 2, ['Wanderers'], true),
  p('Rottingdean', 2, [], true),
  p('Saltdean', 2, ['United'], true),
  p('Ovingdean', 2, [], true),
  p('Moulsecoomb', 2, ['Rovers'], true),
  p('Bevendean', 2, [], true),
  p('Coldean', 2, [], true),
  p('Whitehawk', 2, ['Rangers'], true),
  p('Kemptown', 2, [], true),
  p('Hanover', 2, [], true),
  p('Hollingdean', 2, [], true),
  p('Aldrington', 2, ['Rangers'], true),
  p('Mile Oak', 2, ['Wanderers'], true),
  p('Portslade', 2, ['Athletic', 'Rangers'], true),
  p('Stanmer', 2, [], true),
  p('Falmer', 2, [], true),
  p('Tongdean', 2, [], true),
  p('West Blatchington', 2, [], true),
  p('Brunswick', 2, [], true),
  p('Round Hill', 2, [], true),

  // Villages
  p('Upper Beeding', 1),
  p('Bramber', 1),
  p('Ditchling', 1),
  p('Hurstpierpoint', 1),
  p('Lindfield', 1),
  p('Cuckfield', 1, ['Rangers', 'Town']),
  p('Ringmer', 1),
  p('Findon', 1),
  p('Ferring', 1),
  p('East Preston', 1),
  p('Pagham', 1),
  p('Bosham', 1),
  p('Alfriston', 1),
  p('Pevensey', 1),
  p('Wadhurst', 1, ['United']),
  p('Mayfield', 1),
  p('Forest Row', 1),
  p('Robertsbridge', 1, ['United']),
  p('Winchelsea', 1),
  p('Amberley', 1),
  p('Partridge Green', 1),
  p('Cowfold', 1),
  p('Bolney', 1, ['Rovers']),
  p('Ardingly', 1),
  p('Balcombe', 1),
  p('Plumpton', 1, ['Athletic']),
  p('Barcombe', 1),
  p('Glynde', 1),
  p('Poynings', 1),
  p('Small Dole', 1),
  p('Ashington', 1, ['Rovers']),
  p('West Chiltington', 1),
  p('Rudgwick', 1),
  p('Loxwood', 1),
  p('Wisborough Green', 1),
  p('Slinfold', 1),
  p('Handcross', 1),
  p('Newick', 1),
  p('Chailey', 1),
  p('Wivelsfield', 1),
  p('Keymer', 1),
  p('Telscombe', 1),
  p('Herstmonceux', 1),
  p('Burwash', 1),
  p('Ticehurst', 1),
  p('Northiam', 1),
  p('Sedlescombe', 1, ['Rangers']),
  p('Fletching', 1),
  p('Buxted', 1),
  p('Rotherfield', 1),
  p('Willingdon', 1, ['Athletic']),
  p('Scaynes Hill', 1),
];

// Real club names checked on 11 Nov 2026 (Southern Combination, Mid Sussex and
// Brighton leagues, plus Brighton & Hove council's pitch report). Used as a
// final safety net and by the tests. Compared without "FC"/"AFC" and case.
export const REAL_CLUBS = [
  'Brighton & Hove Albion', 'Crawley Town', 'Lewes', 'Horsham', 'Horsham YMCA', 'Horsham Athletic',
  'Worthing', 'Worthing United', 'Worthing Town', 'Eastbourne Borough', 'Eastbourne Town',
  'Eastbourne United', 'Eastbourne United Association', 'Eastbourne Athletic', 'Eastbourne Rangers',
  'Hastings United', 'Hastings Town', 'Hastings Rangers', 'Crawley United', 'Crawley Down Gatwick',
  'Burgess Hill Town', 'Burgess Hill Albion', 'Haywards Heath Town', 'Bognor Regis Town',
  'Chichester City', 'Chichester United', 'Littlehampton Town', 'Littlehampton United', 'Shoreham',
  'Lancing', 'Lancing United', 'Whitehawk', 'Whitehawk Rangers', 'Newhaven', 'Peacehaven & Telscombe',
  'Peacehaven and Telscombe Rangers', 'Saltdean United', 'Saltdean', 'Seaford Town', 'Hailsham Town',
  'Bexhill United', 'Bexhill Town', 'Little Common', 'Crowborough Athletic', 'Uckfield Town',
  'Uckfield United', 'East Grinstead Town', 'East Grinstead United', 'East Grinstead Meads',
  'Three Bridges', 'Hassocks', 'Keymer & Hassocks', 'Steyning Town', 'Storrington', 'Arundel',
  'Pagham', 'Selsey', 'Midhurst & Easebourne', 'Wick', 'East Preston', 'Rustington', 'Southwick',
  'Southwick 1882', 'Southwick Rangers', 'Mile Oak', 'Mile Oak Wanderers', 'Ringmer',
  'Broadbridge Heath', 'Loxwood', 'Billingshurst', 'Oakwood', 'Sidley United', 'Westfield',
  'Rye Town', 'Rye United', 'Roffey', 'Ferring', 'Upper Beeding', 'Hurstpierpoint', 'Cuckfield Rangers',
  'Cuckfield Town', 'Lindfield', 'Balcombe', 'Ditchling', 'Henfield', 'Montpelier Villa',
  'Varndeanians', 'Patcham United', 'Hollingbury Hawks', 'Hangleton Rangers', 'Woodingdean Wanderers',
  'Coldean Colts', 'Aldrington Rangers', 'Portslade Athletic', 'Preston Park', 'Queens Park',
  'East Brighton Wanderers', 'Moulsecoomb & Bevendean', 'Moulsecoomb Rovers', 'Withdean Youth',
  'Withdean 2000', 'Ovingdean', 'Hove Park Rangers', 'Hove Park Colts', 'Fishersgate Flyers',
  'Rottingdean Village', 'Rottingdean', 'Polegate Town', 'Willingdon Athletic', 'Forest Row',
  'Sedlescombe Rangers', 'Hollington United', 'Wadhurst United', 'Robertsbridge United',
  'Bolney Rovers', 'Plumpton Athletic', 'Newick', 'Barcombe', 'Buxted', 'Fletching', 'Rotherfield',
  'Scaynes Hill', 'Wivelsfield Green', 'Handcross Village', 'Ardingly', 'Bosham', 'Southwater',
  'Copthorne', 'Battle Town', 'Heathfield United', 'Petworth', 'Angmering', 'Brighton Electricity',
];

/** Lower-case, without FC/AFC, "and" as "&": the form names are compared in. */
export function normaliseClubName(name) {
  return name
    .toLowerCase()
    .replace(/\band\b/g, '&')
    .replace(/\b(a\.?f\.?c\.?|f\.?c\.?)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const REAL_SET = new Set(REAL_CLUBS.map(normaliseClubName));

export function isRealClubName(name) {
  return REAL_SET.has(normaliseClubName(name));
}

/** Suffixes this place may use: no "Town" for villages, none a real club uses. */
export function allowedSuffixes(place) {
  return SUFFIXES.filter(
    (s) =>
      !place.avoid.includes(s) &&
      !(s === 'Town' && place.size < 3) &&
      !isRealClubName(`${place.name} ${s}`),
  );
}
