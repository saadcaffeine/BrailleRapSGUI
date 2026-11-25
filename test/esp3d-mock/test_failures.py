# Status lights, staged progress, flashing, STOP/restart and failure handling, against the mock.
import json, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://embosser.test:8080/braille.html'
def get(path): return json.load(urllib.request.urlopen('http://127.0.0.1:8080' + path))
def scenario(mode, home=1, reset=False): get(f'/__scenario?mode={mode}&home={home}' + ('&reset=1' if reset else ''))
def body_has(page, text, timeout=20000):
    page.wait_for_function(f"document.body.innerText.includes({json.dumps(text)})", timeout=timeout)
def led(page, name):
    el = page.locator(f'[aria-label^="{name}:"]').first
    return el.get_attribute('aria-label'), el.locator('.br-status__led').get_attribute('class')
def seg(page, key): return page.locator(f'.br-job__seg--{key}').get_attribute('data-state')
def btn(page, name): return page.get_by_role('button', name=name, exact=True)
def dialog_title(page): return page.locator('div[role=dialog] h2').inner_text()

fails = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)
def wait_until(fn, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if fn(): return True
        except Exception: pass
        time.sleep(0.1)
    return False
def wait_led(page, name, colour, timeout=15): return wait_until(lambda: f'--{colour}' in led(page, name)[1], timeout)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome',
                          args=['--host-resolver-rules=MAP embosser.test 127.0.0.1', '--no-sandbox', '--no-proxy-server'])
    page = b.new_page(viewport={'width': 412, 'height': 915})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    scenario('normal', 2, reset=True)
    page.goto(BASE); page.wait_for_selector('text=GENERATE')
    ta = page.locator('textarea').first
    ta.fill('Hello 123'); btn(page, 'GENERATE').click()

    # header / footer
    check(page.locator('[aria-label=Settings]').count() == 1 and btn(page, 'SETTINGS').count() == 0, 'settings is a gear icon, no SETTINGS button')
    check(page.get_by_role('button', name='Emergency stop').count() == 1 and btn(page, 'STOP').count() == 0, 'STOP is an emergency-stop icon')
    foot = page.locator('.br-ui-footer').inner_text()
    check('©' not in page.inner_text('body') and 'MIT License' not in foot, 'copyright line removed')
    check(all(u in foot for u in ['kyjanond', 'braillerap', 'luc-github', 'MarlinFirmware', 'me-no-dev', 'links2004']), 'GitHub credits after the heart')

    # LEDs (mock: x_min open, y_min TRIGGERED)
    check(wait_led(page, 'LINK', 'green'), 'LINK green when connected')
    check(wait_led(page, 'SD', 'green'), 'SD green (card ok)')
    check(wait_led(page, 'X STOP', 'amber'), 'X STOP amber when not on the limit switch')
    check(page.evaluate("() => !localStorage.getItem('braillerap-sg-settings') || JSON.parse(localStorage.getItem('braillerap-sg-settings')).paperSensorInverted !== false"), 'default paper polarity: open = paper')
    check(wait_led(page, 'PAPER', 'green'), 'PAPER green when sensor says paper present')
    page.click('[aria-label=Settings]'); page.get_by_label("paper sensor reads 'open' when paper is in").uncheck(); btn(page, 'Save and exit').click()
    check(wait_led(page, 'PAPER', 'amber', 5), 'PAPER amber after inverting the sensor setting')
    page.click('[aria-label=Settings]'); page.get_by_label("paper sensor reads 'open' when paper is in").check(); btn(page, 'Save and exit').click()
    btn(page, 'GENERATE').click()   # changing settings clears the generated G-code

    # staged progress, disabled buttons, per-dot flashing
    btn(page, 'PRINT').click()
    check(wait_until(lambda: seg(page, 'homing') == 'active', 8), 'homing segment active first')
    check(btn(page, 'PRINT').is_disabled() and btn(page, 'GENERATE').is_disabled(), 'PRINT and GENERATE disabled while printing')
    check(wait_until(lambda: seg(page, 'paper') == 'active' and seg(page, 'homing') == 'done', 8), 'then paper segment active, homing done')
    check(wait_until(lambda: seg(page, 'printing') == 'active' and seg(page, 'paper') == 'done', 10), 'then embossing segment active')
    body_has(page, 'dots', 5000)
    canvas = page.locator('.br-ui-input__braille-canvas')
    check('br-embossing' in canvas.get_attribute('class') and page.locator('.br-job__solenoid').count() == 1,
          'looped embossing animation (preview glow + solenoid icon) while embossing')
    body_has(page, 'Done', 30000)
    check('br-embossing' not in canvas.get_attribute('class') and page.locator('.br-job__solenoid').count() == 0,
          'animation stops when the job is done')
    check(all(seg(page, k) == 'done' for k in ['homing', 'paper', 'printing']), 'all segments done at the end')
    check(not btn(page, 'PRINT').is_disabled(), 'PRINT enabled again after the job')

    # paper not loaded -> paper segment red, PAPER dialog -> Retry without re-upload
    scenario('paperfail', 2)
    btn(page, 'PRINT').click()
    btn(page, 'RETRY').wait_for(timeout=20000)
    check(dialog_title(page) == 'PAPER', 'paper failure shows PAPER dialog')
    check(seg(page, 'paper') == 'failed' and seg(page, 'homing') == 'done', 'paper segment shown as failed')
    uploads_before = sum(1 for c in get('/__log') if c.startswith('UPLOAD'))
    scenario('normal', 1)
    btn(page, 'RETRY').click()
    body_has(page, 'Done', 30000)
    check(sum(1 for c in get('/__log') if c.startswith('UPLOAD')) == uploads_before, 'Retry did not re-upload')

    # firmware halt -> restart -> retry
    scenario('kill', 2)
    btn(page, 'PRINT').click()
    btn(page, 'RESTART EMBOSSER').wait_for(timeout=20000)
    check(dialog_title(page) == 'EMBOSSER STOPPED', 'halt shows EMBOSSER STOPPED dialog')
    check(wait_led(page, 'LINK', 'red', 5), 'LINK red when halted')
    scenario('normal', 1)
    btn(page, 'RESTART EMBOSSER').click()
    check(wait_led(page, 'LINK', 'green', 20), 'LINK green again after restart')
    btn(page, 'RETRY').click()
    body_has(page, 'Done', 30000)
    check(True, 'print succeeds after restart + retry')

    # STOP during embossing
    scenario('normal', 1)
    n_restarts = get('/__log').count('[ESP444]RESTART')
    btn(page, 'PRINT').click()
    check(wait_until(lambda: seg(page, 'printing') == 'active', 15), 'embossing before STOP')
    page.get_by_role('button', name='Emergency stop').click()
    body_has(page, 'Stopped', 10000)
    check(get('/__log').count('[ESP444]RESTART') == n_restarts + 1, 'STOP restarts the controller immediately')
    check(seg(page, 'printing') == 'failed', 'embossing segment marked where it stopped')
    check(wait_led(page, 'LINK', 'green', 20), 'LINK green after STOP restart')
    check(wait_until(lambda: 'embosser ready' in page.locator('.br-job__text').inner_text() and 'restarting' not in page.locator('.br-job__text').inner_text(), 5),
          '"restarting" text replaced once the link is back')

    # restart from settings (two taps)
    page.click('[aria-label=Settings]'); btn(page, 'Restart embosser').click(); btn(page, 'Tap again to restart').click()
    check(get('/__log').count('[ESP444]RESTART') == n_restarts + 2, 'Settings > Restart embosser restarts the controller')
    btn(page, 'CLOSE').click()
    check(wait_led(page, 'LINK', 'green', 20), 'LINK green after settings restart')

    # re-attach after reload, then cancel
    scenario('normal', 1)
    btn(page, 'PRINT').click(); body_has(page, 'Embossing', 15000)
    page.reload(); page.wait_for_selector('text=GENERATE')
    body_has(page, 'Embossing', 15000)
    check(btn(page, 'CANCEL').count() == 1, 'reloaded page re-attaches to running job with CANCEL')
    btn(page, 'CANCEL').click(); body_has(page, 'Cancelled', 15000)
    check('M524' in get('/__log'), 'cancel after reload sends M524')
    n_m119 = get('/__log').count('M119')
    check(wait_led(page, 'LINK', 'green', 10), 'embosser reachable (LINK green) after cancel')
    check(wait_until(lambda: get('/__log').count('M119') > n_m119 + 1, 10), 'status polling continues after cancel')
    check(not btn(page, 'GENERATE').is_disabled(), 'page not stuck busy after cancel (GENERATE enabled)')

    # no SD card
    scenario('nocard', 1)
    check(wait_led(page, 'SD', 'red', 25), 'SD red when no card')
    ta = page.locator('textarea').first; ta.fill('x'); btn(page, 'GENERATE').click(); btn(page, 'PRINT').click()
    page.wait_for_selector('div[role=dialog] >> text=No SD card', timeout=15000)
    check(True, 'printing without a card gives a clear error')
    btn(page, 'CLOSE').click()
    scenario('normal', 1)
    if errs: fails.append(f'page errors: {errs}')
    b.close()

print('\nALL PASSED' if not fails else '\nFAILURES:\n' + '\n'.join(fails))
sys.exit(1 if fails else 0)
