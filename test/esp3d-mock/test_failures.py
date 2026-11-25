# Failure handling + status LEDs, against the mock ESP3D/Marlin server.
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
def dialog_title(page): return page.locator('div[role=dialog] h2').inner_text()

fails = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

def wait_led(page, name, colour, timeout=15):
    t0 = time.time()
    while time.time() - t0 < timeout:
        _, cls = led(page, name)
        if f'--{colour}' in cls: return True
        time.sleep(0.25)
    return False

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome',
                          args=['--host-resolver-rules=MAP embosser.test 127.0.0.1', '--no-sandbox', '--no-proxy-server'])
    page = b.new_page(viewport={'width': 412, 'height': 915})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    scenario('normal', 1, reset=True)
    page.goto(BASE); page.wait_for_selector('text=GENERATE')
    ta = page.locator('textarea').first
    ta.fill('Hello 123'); page.click('text=GENERATE')

    # LEDs
    check(wait_led(page, 'LINK', 'green'), 'LINK green when connected')
    check(wait_led(page, 'SD', 'green'), 'SD green (card ok)')
    check(wait_led(page, 'X STOP', 'green'), 'X STOP open -> green')
    check(wait_led(page, 'PAPER', 'amber'), 'PAPER sensor triggered -> amber')
    check('not measured' in led(page, 'POWER')[0], 'POWER shown as not measured')

    # slow homing (14 s of busy keepalives, longer than the old 5 s query timeout + 30 s lost window would need)
    scenario('normal', 14)
    page.click('text=PRINT')
    body_has(page, 'Homing and loading paper', 10000)
    check(wait_led(page, 'LINK', 'amber', 12), 'LINK amber (busy) while homing')
    body_has(page, 'Done', 40000)
    check(page.locator('div[role=dialog]').count() == 0, 'slow homing finishes without an error dialog')

    # paper not loaded -> PAPER dialog -> Retry runs the file again without re-uploading
    scenario('paperfail', 2)
    page.click('text=PRINT')
    page.wait_for_selector('div[role=dialog] >> text=RETRY', timeout=20000)
    check(dialog_title(page) == 'PAPER', 'paper failure shows PAPER dialog')
    check(page.locator('div[role=dialog] >> text=Paper did not load').count() == 1, 'paper message shown')
    uploads_before = sum(1 for c in get('/__log') if c.startswith('UPLOAD'))
    scenario('normal', 1)
    page.get_by_role('button', name='RETRY', exact=True).click()
    body_has(page, 'Done', 30000)
    log = get('/__log')
    check(sum(1 for c in log if c.startswith('UPLOAD')) == uploads_before, 'Retry did not re-upload')
    check(log[-40:].count('M24') >= 1, 'Retry sent M23/M24')

    # firmware halt -> EMBOSSER STOPPED -> restart -> retry
    scenario('kill', 2)
    page.click('text=PRINT')
    page.wait_for_selector('div[role=dialog] >> text=RESTART EMBOSSER', timeout=20000)
    check(dialog_title(page) == 'EMBOSSER STOPPED', 'halt shows EMBOSSER STOPPED dialog')
    check(wait_led(page, 'LINK', 'red', 5), 'LINK red when halted')
    scenario('normal', 1)
    page.get_by_role('button', name='RESTART EMBOSSER', exact=True).click()
    page.wait_for_selector('div[role=dialog] >> text=RESTARTING', timeout=5000)
    check('[ESP444]RESTART' in get('/__log'), 'restart sends [ESP444]RESTART')
    check(wait_led(page, 'LINK', 'green', 20), 'LINK green again after restart')
    page.get_by_role('button', name='RETRY', exact=True).click()
    body_has(page, 'Done', 30000)
    check(True, 'print succeeds after restart + retry')

    # re-attach after page reload during a job, then cancel it
    scenario('normal', 1)
    page.click('text=PRINT'); body_has(page, 'Embossing', 15000)
    page.reload(); page.wait_for_selector('text=GENERATE')
    body_has(page, 'Embossing', 15000)
    check(page.get_by_role('button', name='CANCEL', exact=True).count() == 1, 'reloaded page re-attaches to running job with CANCEL')
    page.get_by_role('button', name='CANCEL', exact=True).click(); body_has(page, 'Cancelled', 15000)
    check('M524' in get('/__log'), 'cancel after reload sends M524')

    # no SD card
    scenario('nocard', 1)
    check(wait_led(page, 'SD', 'red', 25), 'SD red when no card')
    ta = page.locator('textarea').first; ta.fill('x'); page.click('text=GENERATE'); page.click('text=PRINT')
    page.wait_for_selector('div[role=dialog] >> text=No SD card', timeout=15000)
    check(True, 'printing without a card gives a clear error')
    page.get_by_role('button', name='CLOSE', exact=True).click()
    scenario('normal', 1)
    page.screenshot(path='status.png')
    if errs: fails.append(f'page errors: {errs}')
    b.close()

print('\nALL PASSED' if not fails else '\nFAILURES:\n' + '\n'.join(fails))
sys.exit(1 if fails else 0)
