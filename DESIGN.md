# Grassroots Manager – DESIGN

Last updated: 11 Nov 2026 (M2, v1)

A stripped-back football manager for the phone, set in a fictional Sussex pyramid. Installed to the home screen from GitHub Pages and fully offline, like Stuart's other apps.

- Full design doc (Claude doc): https://claude.ai/artifact/W3zETGB2W8NdRdwzGqJUC8
- M1 engine report (artifact, built from `stats/`): https://claude.ai/artifact/KDkWEQk3HvQ5RpyZ7dKbKA
- App preview (artifact, built by `npm run build:preview`; publish `dist/preview.html` to the same artifact each time): https://claude.ai/artifact/MmZwB3Pzyu3Ws6isJtDvcQ
- House rules: the Phone Web App Playbook in the Artifact App Development project

## Status

| Milestone | Status |
| --- | --- |
| M1 – Engine and world generator | Built 11 Nov 2026, waiting for Stuart's review |
| M1b – Player ratings and stats in the engine | Built 11 Nov 2026, waiting for Stuart's review |
| M2 – One playable season (first release, v1) | Built 11 Nov 2026 and pushed to `main`; waiting for Stuart to switch on Pages and try it |
| M3 – Live matches and tactics | Not started |
| M4 – Multiple seasons | Not started |
| M5 – Transfers and money | Not started |
| M6 – Club building | Not started |
| M7 – Optional extras | Not started |

The app is at v1. Live address once Pages is on: https://sgoodwin-cloud.github.io/grassroots-manager/

## Files

| Path | What it is |
| --- | --- |
| `index.html`, `css/app.css` | The page and its one light theme. |
| `js/app.js` | Every screen, tap handling, and the update bar. Holds `APP_VERSION`. |
| `js/game.js` | The game rules with no screen code: new game, team selection, playing a round, tables and stats. |
| `js/store.js` | Three save slots in IndexedDB, with an in-memory fallback. |
| `sw.js` | Service worker. Holds `VERSION` and the `CORE` cache list. |
| `manifest.json`, `icons/`, `fonts/` | Home-screen install, icons, bundled Inter and Space Grotesk. |
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
| `tools/build-preview.js` | `npm run build:preview`: the app as one file for an artifact preview. |
| `tools/playtest.py` | `npm run playtest`: headless full-season play-through at 390 × 844, with layout, saved-state and offline checks. |
| `tools/update-test.py` | `npm run update-test`: updates from the current version to a bumped copy through a stale CDN. |
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
| Home wins | 44.1% | 42–48% |
| Draws | 23.5% | 22–28% |
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

## Screens (v1)

- **Start menu**: three save slots; delete asks first on an in-page sheet.
- **New game**: a world code, the twelve bottom-division clubs with a team rating, or your own club name.
- **Home**: next match, your record, last result. At season end, a summary.
- **Team selection**: formation, eleven slots, bench. Tap a slot to choose from the squad sorted by rating in that position. Changing formation auto-picks.
- **Squad**: colour-coded attributes. Tap a player for his sheet (attributes, season stats, last five ratings).
- **Fixtures**: your 22 matches; tap a played one for its report.
- **Table**: any division, plus top tens for goals, assists and average rating.
- **Stats**: your squad's games, goals, assists, average rating and awards, sortable.
- **Match report**: score, scorers, stats, both teams' ratings, player of the match, other results.

Fit targets met at 390 × 844: the 12-row table, and the eleven plus main buttons on team selection, without scrolling.

## Save format (version 1)

IndexedDB database `grassroots-manager`, stores `saves` and `slots`, keyed by slot number 1–3. `slots` holds the small summary shown on the start menu; both are written in one transaction.

```
save = {
  version: 1, createdAt, updatedAt,
  world,            // from generateWorld(): seed, divisions, clubs, players
  userClubId,
  season: 1,
  round,            // rounds played so far (0–22)
  results: [...],   // every match in every division, with player stat lines
  lineup: { formation, slots: [{ playerId, role }] },
}
```

- Fixtures are never stored: `fixturesFor(world, season, division)` rebuilds them from the seed.
- Tables, form, stats and top tens are worked out from `results`.
- `migrate()` in `js/game.js` upgrades older saves step by step and never wipes one. A line-up that no longer fits the squad is replaced with the best eleven.
- At the end of season 1 the save simply stops at round 22. M4 must pick these saves up and carry them into season 2.

## Release process

Follow the playbook. In short:

1. `npm test`, `npm run playtest`, and `npm run update-test` when the update code or save format changes.
2. Bump `APP_VERSION` (js/app.js) and `VERSION` (sw.js) to the same number; add any new file to `CORE`. A test fails if they differ or an imported file is missing from `CORE`.
3. `npm run build:preview` and publish `dist/preview.html` to the preview artifact.
4. Push to a milestone branch; merge to `main` after Stuart approves. v1 went straight to `main` because nothing was installed yet.
5. Wait for the GitHub deployment to succeed before telling Stuart to update.

## Decision log

| Date | Decision |
| --- | --- |
| 10 Nov 2026 | Adult football; 12-club divisions; text-only matches with Watch or Skip; 1–20 attributes with colour bands; no fail state; one club per save; three save slots |
| 11 Nov 2026 | Named Grassroots Manager; four divisions; Brighton & Hove neighbourhoods in the place list; never match a real club; start in the bottom division, with a create-your-own-club option |
| 11 Nov 2026 | M1: four position groups (GK, DEF, MID, ATT) rather than left/right/centre roles |
| 11 Nov 2026 | M1: the engine works on rating-point gaps, not ratios, so the bottom division plays like the top one |
| 11 Nov 2026 | M1: the bare "FC" suffix is dropped; Rangers and Albion added |
| 11 Nov 2026 | M1: divisions are Premier Division, Division One, Division Two, Division Three |
| 11 Nov 2026 | M2: one light theme; portrait; five tabs (Home, Squad, Fixtures, Table, Stats) |
| 11 Nov 2026 | M2: every division is played each round, not only yours, so all four tables and top tens are live |
| 11 Nov 2026 | M2: the season stops after round 22 with a summary; the save carries on when M4 adds new seasons |
| 11 Nov 2026 | M2: changing formation auto-picks the best eleven for it; picking a player already in the team swaps the two |
| 11 Nov 2026 | M2: fixed fixture venues. The M1 schedule could give a club eleven home matches in a row; no club now has more than three |
| 11 Nov 2026 | M1b: per-match player ratings on Football Manager's scale, built from individual events rather than made up after the match |
| 11 Nov 2026 | M1b: goals, assists and ratings tracked for every player in the world; your team's stats screen and league top tens go in M2 |
| 11 Nov 2026 | M1b: form (last five ratings) is shown from M2 but does not affect performance until M7, and then only slightly |
