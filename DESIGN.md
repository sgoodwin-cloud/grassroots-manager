# Grassroots Manager – DESIGN

Last updated: 11 Nov 2026

A stripped-back football manager for the phone, set in a fictional Sussex pyramid. Installed to the home screen from GitHub Pages and fully offline, like Stuart's other apps.

- Full design doc (Claude doc): https://claude.ai/artifact/W3zETGB2W8NdRdwzGqJUC8
- M1 engine report (artifact, built from `stats/`): https://claude.ai/artifact/KDkWEQk3HvQ5RpyZ7dKbKA
- House rules: the Phone Web App Playbook in the Artifact App Development project

## Status

| Milestone | Status |
| --- | --- |
| M1 – Engine and world generator | Built 11 Nov 2026, waiting for Stuart's review |
| M1b – Player ratings and stats in the engine | Built 11 Nov 2026, waiting for Stuart's review |
| M2 – One playable season (first release) | Not started |
| M3 – Live matches and tactics | Not started |
| M4 – Multiple seasons | Not started |
| M5 – Transfers and money | Not started |
| M6 – Club building | Not started |
| M7 – Optional extras | Not started |

There is no app yet: no `index.html`, service worker or saves. Those arrive in M2.

## Files

| Path | What it is |
| --- | --- |
| `js/rng.js` | Seeded random numbers. All randomness goes through here. |
| `js/data/places.js` | Sussex places and Brighton & Hove neighbourhoods, the suffixes each may use, and the list of real clubs to avoid. |
| `js/data/names.js` | First names and surnames for generated players. |
| `js/player.js` | Attributes, position ratings, colour bands, player generation. |
| `js/world.js` | World generator: 4 divisions × 12 clubs × 22 players from one seed. |
| `js/team.js` | Formations, picking an eleven, unit strengths. |
| `js/match.js` | The 90-tick match engine and its tuning values. |
| `js/league.js` | Fixtures, season simulation, league table. |
| `js/stats.js` | Season totals per player and top tens, worked out from match stat lines. |
| `js/calibrate.js` | Measures the engine over many seasons. |
| `tools/calibrate.js` | `npm run calibrate`: prints the measurements. |
| `tools/build-stats.js` | `npm run build:stats`: bundles the stats page into `dist/stats.html`. |
| `stats/` | Source of the M1 engine report page. |
| `test/` | `npm test` (Node's built-in test runner, no dependencies). |

The engine files have no screen code, so they run in Node for tests and in the browser unchanged.

## How the engine works

- **Players** have eight attributes on 1–20 (keepers have seven of their own). A position rating is a weighted sum of attributes, never stored. Out of position costs 8% (accomplished) or 20% (unfamiliar).
- **Positions** are four groups: GK, DEF, MID, ATT. Squads are 2 / 7 / 7 / 6.
- **A team** is four numbers: keeper, defence, midfield, attack. Each is the mean rating of that line, plus or minus rating points for having more or fewer players than a 4-4-2.
- **A match** is 90 one-minute ticks. Each minute one side has the ball (midfield v midfield). That side may shoot (attack v defence), the shot may be on target (shooter v defence), and may go in (shooter v keeper). Every step works on the gap in rating points, so one point of advantage is worth the same in any division.
- **Home advantage** adds 0.95 rating points to the home midfield and attack.
- **Seeded**: a match seed gives an identical match every time. The match state holds the random-number state, so a match can be played a minute at a time, saved and resumed (needed for M3's pauses).
- Simulations count whole minutes, never floating-point time.

Tuning values live in `TUNING` and `RATING` in `js/match.js` and `COUNT_BONUS` in `js/team.js`.

## Player ratings and stats

- **Scale**: Football Manager's 1.0–10.0 to one decimal. Everyone starts at 6.6. About 6.8 is an average game, 8.0+ is excellent, under 6.0 is poor.
- **How they move**: the odds of each contest are decided at team level, exactly as before. Each contest is then pinned on individuals: who kept the ball, who set up the shot, who took it, who made the tackle and who lost the ball to it, who saved it, and which defender was at fault for a goal. Better players are more likely to be credited and less likely to be blamed.
- **Two random streams**: one decides what happens, the other who did it. Changing how credit is shared can never change a scoreline.
- **At full time**: the result (+0.15 win, −0.15 loss) and clean sheets (keeper +0.5, defenders +0.55) are added. Player of the match is the highest rating.
- **Stat line per player per match**: `{ id, role, min, rating, g, a, sh, sot, kp, tk, sv }`, kept with the result in `players: [home lines, away lines]`, plus `potm`.
- **Season totals are derived** from those lines by `playerTotals()`: apps, minutes, goals, assists, average and best rating, player-of-the-match awards, clean sheets, last five ratings (form).
- **Top tens** (`leaders()`): goals, assists, average rating. Average rating only ranks players with at least half the rounds played so far (`minAppsForRating()`).
- **Planned storage** (M2/M4): full match lines for the current season; at season end each player's season is rolled up into one totals line and the match lines for other clubs are dropped. This is a deliberate exception to "store the history, work out the totals".
- **Rating colours** on the report page: under 6.0 red, 6.0–6.9 amber, 7.0–7.9 green, 8.0+ blue. To confirm for the app in M2.

## Calibration (60 worlds, 31,680 matches)

| Measure | Result | Target |
| --- | --- | --- |
| Goals per game | 2.75 | 2.5–3.0 |
| Home wins | 44.2% | 42–48% |
| Draws | 23.3% | 22–28% |
| Shots per team | 12.3 (4.5 on target) | – |
| Goalless draws | 6.2% | – |
| Clear favourite (1.5+ points better) | won 65%, drew 20%, lost 15% | wins most, not always |
| Higher-division club v club from the division below | wins about 60% | – |
| Formations v 4-4-2 | all within 0.03 points per game | none dominant |
| Average player rating | 6.79 | 6.7–6.9 |
| Average rating by position | GK 6.79, DEF 6.81, MID 6.78, ATT 6.77 | within 0.1 of the average |
| Rated 8.0+ / under 6.0 | about 4% / about 5% | both happen, neither common |
| Winning side v losing side | 7.2 v 6.4 | – |
| Player of the match by position | GK 19%, DEF 17%, MID 22%, ATT 42% | not always a striker |
| Division top scorer | about 17 goals in 22 games | – |
| Ability v season average rating | correlation about 0.6 | better players rate higher |

`test/calibration.test.js` fails if any of these drift out of range, so engine changes can't quietly break the football.

## World rules

- 48 places are drawn from 116. Bigger places tend to start higher.
- Club names are `<place> <suffix>` from Town, United, Athletic, Rovers, Wanderers, Rangers, Albion. Villages and neighbourhoods never get "Town".
- **No name may match a real club.** Each place lists the suffixes real clubs there already use, and `REAL_CLUBS` is a second safety net checked by the tests. The bare "FC" suffix is never used, because most real village clubs are plain "<place> FC".
- A custom club name (M2's create-your-own option) replaces one bottom-division club and keeps its squad.

## Save format

Not designed yet (M2). Planned: IndexedDB, three slots, a version number upgraded in `migrate()`, results stored and tables derived. `generateWorld()` already returns a plain object with a `version` field.

## Release process

Follow the playbook. In short: preview in an artifact, push to a milestone branch, merge to `main` after Stuart approves, bump `APP_VERSION` and `VERSION` together, wait for the deployment before telling Stuart to update. The first release (M2) can go straight to `main`.

## Decision log

| Date | Decision |
| --- | --- |
| 10 Nov 2026 | Adult football; 12-club divisions; text-only matches with Watch or Skip; 1–20 attributes with colour bands; no fail state; one club per save; three save slots |
| 11 Nov 2026 | Named Grassroots Manager; four divisions; Brighton & Hove neighbourhoods in the place list; never match a real club; start in the bottom division, with a create-your-own-club option |
| 11 Nov 2026 | M1: four position groups (GK, DEF, MID, ATT) rather than left/right/centre roles |
| 11 Nov 2026 | M1: the engine works on rating-point gaps, not ratios, so the bottom division plays like the top one |
| 11 Nov 2026 | M1: the bare "FC" suffix is dropped; Rangers and Albion added |
| 11 Nov 2026 | M1: divisions are Premier Division, Division One, Division Two, Division Three |
| 11 Nov 2026 | M1b: per-match player ratings on Football Manager's scale, built from individual events rather than made up after the match |
| 11 Nov 2026 | M1b: goals, assists and ratings tracked for every player in the world; your team's stats screen and league top tens go in M2 |
| 11 Nov 2026 | M1b: form (last five ratings) is shown from M2 but does not affect performance until M7, and then only slightly |
