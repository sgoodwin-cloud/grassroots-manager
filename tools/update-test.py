"""Update test through a stale CDN. Run from the repo root:
    python3 tools/update-test.py
Serves the current app as "v-old", then a copy with the version bumped as "v-new", the way GitHub
Pages does just after a deploy: sw.js is fresh, but plain addresses and the first install attempt
(try=0) still get the old files. The update must still land on the new version and keep the save.
"""
import asyncio, http.server, os, re, shutil, sys, tempfile, threading
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT = os.getcwd()
FILES = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'fonts', 'icons']
PORT = 8766
problems = []

def check(ok, text):
    print(('ok   ' if ok else 'FAIL ') + text)
    if not ok: problems.append(text)

def copy(dest, bump=False):
    for f in FILES:
        src = os.path.join(ROOT, f)
        (shutil.copytree if os.path.isdir(src) else shutil.copy)(src, os.path.join(dest, f))
    old = re.search(r"APP_VERSION = '(\d+)'", open(os.path.join(dest, 'js/app.js')).read()).group(1)
    new = str(int(old) + 1)
    if bump:
        for path, a, b in [('js/app.js', f"APP_VERSION = '{old}'", f"APP_VERSION = '{new}'"),
                           ('sw.js', f"grassroots-manager-v{old}'", f"grassroots-manager-v{new}'")]:
            full = os.path.join(dest, path)
            text = open(full).read()          # read fully before opening for writing (playbook)
            assert a in text
            open(full, 'w').write(text.replace(a, b))
    return old, new

tmp = tempfile.mkdtemp()
OLD, NEW = os.path.join(tmp, 'old'), os.path.join(tmp, 'new')
os.makedirs(OLD); os.makedirs(NEW)
old_v, new_v = copy(OLD)
copy(NEW, bump=True)
mode = {'deploying': False, 'stale_hits': 0}

class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        url = urlparse(path)
        q = parse_qs(url.query)
        rel = url.path.lstrip('/') or 'index.html'
        base = OLD
        if mode['deploying']:
            fresh = rel == 'sw.js' or (f'grassroots-manager-v{new_v}' in q.get('v', ['']) and q.get('try', ['0'])[0] != '0')
            base = NEW if fresh else OLD
            if not fresh: mode['stale_hits'] += 1
        return os.path.join(base, rel)
    def send_head(self):
        # Never answer "not modified": both copies share timestamps (playbook section 6).
        for h in ('If-Modified-Since', 'If-None-Match'):
            if h in self.headers: del self.headers[h]
        return super().send_head()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()
    def log_message(self, *a): pass

server = http.server.ThreadingHTTPServer(('localhost', PORT), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        page = await ctx.new_page()
        await page.goto(f'http://localhost:{PORT}/')
        await page.wait_for_selector('.start')
        await page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=20000)
        check((await page.locator('.ver').inner_text()).strip() == f'v{old_v}', f'installed version is v{old_v}')
        check(await page.locator('#update').is_hidden(), 'no update bar and no reload on first install')
        await page.locator('[data-action="new-game"][data-slot="1"]').click()
        await page.locator('.pick').first.click()
        await page.locator('[data-action="start-game"]').click()
        await page.wait_for_selector('.tabbar')
        club = (await page.locator('.topbar .club').inner_text()).strip()
        await page.locator('.screen [data-action="play"]').click()
        await page.wait_for_selector('.scoreline')

        mode['deploying'] = True
        await page.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
        await page.wait_for_selector('#update:not([hidden])', timeout=40000)
        check(mode['stale_hits'] > 0, f"the first install attempt was served stale files ({mode['stale_hits']} requests) and the retry recovered")
        box = await page.locator('#update').bounding_box()
        check(box['y'] == 0 and box['width'] == 390, 'update bar is a full-width bar at the top of the page')
        over = await page.evaluate('''() => { const b = document.getElementById('update').getBoundingClientRect(); const t = document.querySelector('.topbar').getBoundingClientRect(); return t.top >= b.bottom - 1; }''')
        check(over, 'update bar pushes the page down, nothing overlaps it')
        await page.screenshot(path=os.path.join(ROOT, 'dist', 'update-bar.png')) if os.path.isdir(os.path.join(ROOT, 'dist')) else None
        mode['deploying'] = False   # reset before the reload so screenshots show what was installed, not what is served
        mode['deploying'] = True
        async with page.expect_navigation(timeout=20000):
            await page.locator('#update').click()
        await page.wait_for_selector('.start')
        check((await page.locator('.ver').inner_text()).strip() == f'v{new_v}', f'one tap moves to v{new_v}')
        check(club in await page.locator('.slot').first.inner_text(), 'the save is kept through the update')
        check(await page.locator('#update').is_hidden(), 'update bar is gone after updating')
        caches = await page.evaluate('caches.keys()')
        check(caches == [f'grassroots-manager-v{new_v}'], f'old cache cleared: {caches}')
        await ctx.set_offline(True)
        await page.reload()
        await page.wait_for_selector('.start')
        check((await page.locator('.ver').inner_text()).strip() == f'v{new_v}', 'new version works offline')
        await browser.close()

try:
    asyncio.run(main())
finally:
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
print(f'\n{len(problems)} problem(s)')
sys.exit(1 if problems else 0)
