"""Headless play-through at iPhone size. Run from the repo root:
    python3 tools/playtest.py [screenshot-dir]
Starts a local server, plays a full season, checks layout, saved state and offline use.
"""
import asyncio, subprocess, sys, time, os
from playwright.async_api import async_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else 'dist/shots'
PORT = 8765
URL = f'http://localhost:{PORT}/'
os.makedirs(OUT, exist_ok=True)
problems = []

def check(ok, text):
    print(('ok   ' if ok else 'FAIL ') + text)
    if not ok: problems.append(text)

async def main():
    server = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
            page = await ctx.new_page()
            errors = []
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: errors.append(str(e)))

            async def shot(name):
                await page.screenshot(path=f'{OUT}/{name}.png')
                wide = await page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
                inner = await page.evaluate('''() => [...document.querySelectorAll('.screen, .sheet-body')].some(e => e.scrollWidth > e.clientWidth + 1)''')
                check(wide <= 0 and not inner, f'{name}: no sideways scrolling')

            async def tap(selector):
                await page.locator(selector).first.click()

            async def fits(name):
                ok = await page.evaluate('''() => { const s = document.querySelector('.screen'); return s.scrollHeight <= s.clientHeight + 1; }''')
                check(ok, f'{name}: fits without scrolling')

            await page.goto(URL)
            await page.wait_for_selector('.start')
            await shot('01-start')
            check(await page.locator('.slot').count() == 3, 'start menu shows three save slots')

            await tap('[data-action="new-game"][data-slot="1"]')
            await page.wait_for_selector('.picks')
            check(await page.locator('.pick').count() == 12, 'new game lists twelve clubs')
            await tap('[data-action="start-game"]')
            check(await page.locator('.error').count() == 1, 'starting without a club shows a message')
            await page.locator('.pick').nth(5).click()
            await shot('02-new-game')
            club = (await page.locator('.pick.is-on .grow').inner_text()).strip()
            await tap('[data-action="start-game"]')
            await page.wait_for_selector('.tabbar')
            check((await page.locator('.topbar .club').inner_text()).strip() == club, f'managing {club}')
            await shot('03-home')

            await tap('[data-action="team"]')
            await page.wait_for_selector('.teamlist')
            await shot('04-team')
            rows = await page.locator('.teamlist').first.locator('.slotrow').count()
            check(rows == 11, 'team selection shows eleven players')
            box = await page.locator('.screen [data-action="watch"]').bounding_box()
            # 763 is the usable height on Stuart's iPhone 13 once the status bar and home bar are taken out.
            check(box['y'] + box['height'] <= 763, 'team selection: eleven plus the main buttons fit in 763px without scrolling')
            await tap('[data-action="tactics"]')
            await page.wait_for_selector('.sheet')
            await tap('[data-action="set-tactic"][data-key="tempo"][data-value="1"]')
            await shot('04b-tactics')
            await tap('[data-action="close-sheet"]')
            check('1 changed' in await page.locator('[data-action="tactics"]').inner_text(), 'tactics are set from team selection')
            await tap('[data-formation="4-3-3"]')
            check(await page.locator('.chip.is-on').inner_text() == '4-3-3', 'formation changes')
            await page.locator('.teamlist').first.locator('.slotrow').nth(6).click()
            await page.wait_for_selector('.sheet')
            await shot('05-pick-sheet')
            before = await page.locator('.teamlist').first.locator('.slotrow').nth(6).locator('.who').inner_text()
            await page.locator('.sheet .slotrow:not(.is-current)').nth(14).click()
            after = await page.locator('.teamlist').first.locator('.slotrow').nth(6).locator('.who').inner_text()
            check(before != after, 'picking a player changes the slot')
            await tap('[data-action="auto-pick"]')

            async def play_round():
                await tap('.screen [data-action="play"]')
                # Someone suspended or injured in the eleven: let auto-pick fix it, then play.
                if await page.locator('.sheet [data-action="fix-auto"]').count():
                    fixes.append(1)
                    await tap('.sheet [data-action="fix-auto"]')
                    await tap('.screen [data-action="play"]')
                await page.wait_for_selector('.ratings')
            fixes = []

            async def watch_match():
                await tap('.screen [data-action="watch"]')
                if await page.locator('.sheet [data-action="fix-auto"]').count():
                    fixes.append(1)
                    await tap('.sheet [data-action="fix-auto"]')
                    await tap('.screen [data-action="watch"]')
                await page.wait_for_selector('.feed li')

            await play_round()
            await shot('06-report')
            check(await page.locator('.ratings tr:not(.is-sub)').count() == 11, 'report shows eleven starters with ratings')
            await page.locator('.seg button').nth(1).click()
            await page.locator('.ratings tr').first.click()
            await page.wait_for_selector('.sheet')
            await shot('07-player-sheet')
            await tap('[data-action="close-sheet"]')
            await tap('.btn[data-action="close-sub"]')
            await page.wait_for_selector('.tabbar')

            # Round 2: watch the match, change tactics and make a substitution at half-time.
            await watch_match()
            await tap('[data-speed="4"]')
            changed = False
            for _ in range(600):
                if await page.locator('[data-action="live-finish"]').count(): break
                if await page.locator('[data-action="live-replace"]').count():
                    await page.locator('[data-action="live-replace"]').first.click()
                if await page.locator('.sheet').count():
                    await tap('[data-action="close-sheet"]')
                reason = page.locator('.live-reason')
                if await reason.count():
                    if not changed and 'half' in (await reason.inner_text()).lower():
                        await shot('06b-live-half-time')
                        await tap('[data-action="live-changes"]')
                        await page.wait_for_selector('.sheet')
                        await shot('06c-live-changes')
                        await tap('[data-action="live-tactic"][data-key="pressing"][data-value="1"]')
                        await page.locator('.live-row').nth(8).click()
                        await shot('06d-live-substitute')
                        await page.locator('[data-action="live-sub-on"]').first.click()
                        check('2 of 3' in await page.locator('.sheet .section-title').first.inner_text(), 'a substitution uses one of three')
                        check(await page.locator('.sheet .seg.three button.is-on').first.inner_text() == 'Press high', 'tactics change during the match')
                        await tap('[data-action="close-sheet"]')
                        changed = True
                    await tap('[data-action="live-toggle"]')
                await page.wait_for_timeout(120)
            check(changed, 'the match paused at half-time')
            await shot('06e-live-full-time')
            check('full time' in (await page.locator('.clock').inner_text()).lower(), 'a watched match runs to full time')
            await tap('[data-action="live-finish"]')
            await page.wait_for_selector('.ratings')
            check(await page.locator('.ratings tr.is-sub').count() >= 1, 'the report lists the substitute')
            await shot('06f-report-after-watching')
            await tap('.btn[data-action="close-sub"]')
            await page.wait_for_selector('.tabbar')

            # Round 3: start watching, close the app mid-match, and pick it up again.
            await watch_match()
            await tap('[data-speed="4"]')
            await page.wait_for_function("parseInt(document.querySelector('.clock').textContent) >= 12", timeout=20000)
            await tap('[data-action="live-toggle"]') if not await page.locator('.live-reason').count() else None
            minute = int((await page.locator('.clock').inner_text()).strip().rstrip("'"))
            await page.wait_for_timeout(300)
            await page.reload()
            await page.wait_for_selector('.start')
            await tap('[data-action="continue"][data-slot="1"]')
            await page.wait_for_selector('.live-top')
            resumed = int((await page.locator('.clock').inner_text()).strip().rstrip("'"))
            check(resumed == minute, f'a match in progress resumes where it was left ({resumed} v {minute})')
            await shot('06g-live-resumed')
            await tap('[data-action="live-skip"]')
            await page.wait_for_selector('.ratings')
            await tap('.btn[data-action="close-sub"]')
            await page.wait_for_selector('.tabbar')

            for i in range(19):
                await play_round()
                await tap('.topbar [data-action="close-sub"]')
                await page.wait_for_selector('.tabbar')
                if i == 9: await shot('08-home-midseason')
            print(f'     (auto-pick was needed {len(fixes)} time(s) for suspensions or injuries)')
            await shot('09-home-season-over')
            check('season complete' in (await page.locator('.screen').inner_text()).lower(), 'season ends after 22 rounds')
            check(await page.locator('.screen [data-action="play"]').count() == 0, 'no match to play once the season is over')

            await tap('[data-tab="squad"]'); await shot('10-squad')
            check(await page.locator('.attrs tbody tr.tap').count() == 22, 'squad lists 22 players')
            await tap('[data-tab="fixtures"]'); await shot('11-fixtures')
            check(await page.locator('.result-btn').count() == 22, 'fixtures list 22 matches')
            await tap('[data-tab="table"]'); await shot('12-table')
            check(await page.locator('.tablecard tbody tr').count() == 12, 'table has twelve clubs')
            await fits('league table')
            for view in ['goals', 'assists', 'rating']:
                await tap(f'[data-view="{view}"]')
                check(await page.locator('.tablecard tbody tr').count() == 10, f'top ten for {view}')
                await shot(f'13-top-{view}')
            await tap('[data-division="0"]'); await shot('14-premier-ratings')
            await tap('[data-tab="stats"]'); await shot('15-stats')
            first = await page.locator('.tablecard tbody tr').first.locator('td').nth(3).inner_text()
            await tap('[data-key="goals"]')
            top = await page.locator('.tablecard tbody tr').first.locator('td').nth(3).inner_text()
            check(int(top) >= int(first), 'stats sort by goals')
            await shot('16-stats-by-goals')
            await tap('[data-action="menu"]'); await shot('17-menu')
            await tap('.sheet [data-action="to-start"]')
            await page.wait_for_selector('.start')
            await shot('18-start-with-save')
            check(club in await page.locator('.slot').first.inner_text(), 'the save shows on the start menu')

            # Saved state survives a reload.
            await page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=15000)
            await page.reload()
            await page.wait_for_selector('.start')
            check('Season complete' in await page.locator('.slot').first.inner_text(), 'saved game survives a reload')

            # Offline: the app, its fonts and the save all still work.
            await ctx.set_offline(True)
            await page.reload()
            await page.wait_for_selector('.start')
            await tap('[data-action="continue"]')
            await page.wait_for_selector('.tabbar')
            fonts = await page.evaluate('''async () => { await document.fonts.ready; return document.fonts.check("700 20px 'Space Grotesk'") && document.fonts.check("15px 'Inter'"); }''')
            check(fonts, 'offline: bundled fonts load')
            check('season complete' in (await page.locator('.screen').inner_text()).lower(), 'offline: app and save still work')
            await tap('[data-tab="table"]')
            await shot('19-offline-table')
            await ctx.set_offline(False)

            # Delete needs confirming, and a second slot is independent.
            await tap('[data-action="menu"]'); await tap('.sheet [data-action="to-start"]')
            await page.wait_for_selector('.start')
            await tap('[data-action="new-game"][data-slot="2"]')
            await page.fill('#club-name', 'Goodwin Athletic')
            await shot('20-own-club')
            await tap('[data-action="start-game"]')
            await page.wait_for_selector('.tabbar')
            check((await page.locator('.topbar .club').inner_text()).strip() == 'Goodwin Athletic', 'your own club name is used')
            await tap('[data-action="menu"]'); await tap('.sheet [data-action="to-start"]')
            await page.wait_for_selector('.start')
            check(await page.locator('[data-action="continue"]').count() == 2, 'two saves side by side')
            await tap('[data-action="ask-delete"][data-slot="2"]')
            await shot('21-delete-confirm')
            await tap('.sheet [data-action="close-sheet"]')
            check(await page.locator('[data-action="continue"]').count() == 2, 'cancelling keeps the save')
            await tap('[data-action="ask-delete"][data-slot="2"]')
            await tap('.sheet [data-action="delete"]')
            await page.wait_for_selector('.sheet', state='detached')
            check(await page.locator('[data-action="continue"]').count() == 1, 'deleting removes only that save')

            real = [e for e in errors if 'favicon' not in e]
            check(not real, f'no console errors {real[:3]}')
            await browser.close()
    finally:
        server.terminate()
    print(f'\n{len(problems)} problem(s)')
    sys.exit(1 if problems else 0)

asyncio.run(main())
