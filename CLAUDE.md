# Grassroots Manager – notes for Claude

Read `DESIGN.md` first. It has the milestone status, file map, how the engine works and the decision log. The fuller design doc is linked from it.

Before building anything, read the Phone Web App Playbook in the Artifact App Development project and follow it.

## Rules for this repo

- All randomness goes through `js/rng.js`. Never call `Math.random()` in `js/`.
- Engine files in `js/` must stay free of screen code so they run in Node.
- Run `npm test` before every commit. The calibration tests must pass; if an engine change moves the numbers, retune (`npm run calibrate`) rather than loosening the tests.
- Club names must never match a real club. When adding a place, add the suffixes real clubs there use to its `avoid` list and the club to `REAL_CLUBS`.
- Tables, form and stats are worked out from stored results, never stored themselves.
- Use Stuart's terms: division, club, squad, round.
- Commit as Stuart: `git -c user.name="Stuart Goodwin" -c user.email="stuartkgoodwin@gmail.com" commit`.
- Release: milestone branch first, `main` only after Stuart approves (the first release is the exception). Update `DESIGN.md` in the same commit.
