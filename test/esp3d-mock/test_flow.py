# End-to-end test of the on-board page against the mock ESP3D server.
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://embosser.test:8080/braille.html'
MARGIN, DOT, CELL, LINE = 10.0, 2.5, 6.0, 10.0
DOTNUM = {(0,0):1,(0,1):2,(0,2):3,(1,0):4,(1,1):5,(1,2):6}

def server_log():
    return json.load(urllib.request.urlopen('http://127.0.0.1:8080/__log'))

def decode(gcode):
    """Recover the cell sequence (per line) from dot positions in the uploaded G-code."""
    x = y = None; dots = []
    for ln in gcode.splitlines():
        m = re.match(r'G1 X([\d.]+) Y([\d.]+)', ln)
        if m: x, y = float(m[1]), float(m[2])
        elif ln.startswith('M3 S1'): dots.append((x, y))
    cells = {}
    for (x, y) in dots:
        line = int((y - MARGIN) // LINE); ci = int(round((x - MARGIN) // CELL))
        dx = round((x - MARGIN - ci * CELL) / DOT); dy = round((y - MARGIN - line * LINE) / DOT)
        cells.setdefault((line, ci), set()).add(DOTNUM[(dx, dy)])
    out = {}
    for (line, ci), s in sorted(cells.items()):
        out.setdefault(line, {})[ci] = sorted(s)
    return dots, out

def expect_cells(expected):
    """expected: list of cells (lists); [] = blank. Returns {cellindex: dots} for line 0."""
    return {i: c for i, c in enumerate(expected) if c}

N = [3,4,5,6]; CAP = [6]
CASES = [
    ('Ab 12',     [CAP,[1],[1,2],[],N,[1],[1,2]]),
    ('ABC def',   [CAP,CAP,[1],[1,2],[1,4],[],[1,4,5],[1,5],[1,2,4]]),
    ('Call 6pm',  [CAP,[1,4],[1],[1,2,3],[1,2,3],[],N,[1,2,4],[1,2,3,4],[1,3,4]]),
    ('2a',        [N,[1,2],[5,6],[1]]),
    ('3.14',      [N,[1,4],[2,5,6],[1],[1,4,5]]),
    ('(a+b)=c',   [[5],[1,2,6],[1],[5],[2,3,5],[1,2],[5],[3,4,5],[5],[2,3,5,6],[1,4]]),
]

failures = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome',
                          args=['--host-resolver-rules=MAP embosser.test 127.0.0.1', '--no-sandbox', '--no-proxy-server'])
    page = b.new_page(viewport={'width': 412, 'height': 915})   # phone-sized
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE); page.wait_for_selector('text=GENERATE')

    # 1. defaults when served from the embosser
    page.click('text=SETTINGS')
    page.wait_for_selector('text=Embosser connection')
    body = page.inner_text('div[role=dialog]')
    for want in ['English UEB grade 1', 'A3 (BrailleRAP XL)', 'standard', 'WiFi (SD card on the embosser)']:
        if want not in body: failures.append(f'default setting missing: {want}')
    page.click('text=Save and exit')

    ta = page.locator('textarea').first
    # 2. translation cases
    for text, exp in CASES:
        ta.fill(text); page.click('text=GENERATE')
        page.click('text=PRINT'); page.wait_for_function("document.body.innerText.includes('state: done')", timeout=20000)
        g = open('uploaded.gco').read()
        dots, lines = decode(g)
        got = lines.get(0, {}); want = expect_cells(exp)
        status = 'ok' if got == want else 'FAIL'
        if got != want: failures.append(f'{text!r}: got {got} want {want}')
        print(f'{status:4} {text!r:14} {len(dots)} dots')

    # 3. G-code sanity for the last job
    xs = [d[0] for d in dots]; ys = [d[1] for d in dots]
    if not g.startswith('G28 X;'): failures.append('gcode does not start with G28 X')
    if max(xs) > 297 - MARGIN or max(ys) > 420 - MARGIN: failures.append('dot outside A3 printable area')
    if 'G1 X0.00 Y420.00;' not in g: failures.append('no eject move to Y420 with X0')
    if g.count('M3 S1') != len(dots): failures.append('dot count mismatch')

    # 4. command order of one job
    log = server_log()
    last = log[max(i for i, c in enumerate(log) if c.startswith('UPLOAD')) - 1:]
    order = [c for c in last if not c.startswith('M27')]
    print('job commands:', order[:4])
    if not (order[0].startswith('UPLOAD /braille.gco') and order[1] == 'M23 /braille.gco' and order[2] == 'M24'):
        failures.append(f'unexpected command order {order}')

    # 5. long text overflows A3 -> warning
    ta.fill(('word ' * 40 + '\n') * 60); page.click('text=GENERATE')
    page.wait_for_selector('text=does not fit', timeout=5000)
    page.keyboard.press('Escape'); page.locator('div[role=dialog] button').first.click() if page.locator('div[role=dialog] button').count() else None

    # 6. cancel mid-print
    ta.fill('Cancel test 123'); page.click('text=GENERATE'); page.click('text=PRINT')
    page.wait_for_selector('text=CANCEL', timeout=10000); page.click('text=CANCEL')
    page.wait_for_function("document.body.innerText.includes('state: cancelled')", timeout=15000)
    if 'M524' not in server_log(): failures.append('M524 not sent on cancel')
    print('cancel: ok')
    page.screenshot(path='phone.png', full_page=True)
    if errors: failures.append(f'page errors: {errors}')
    b.close()

print('\nFAILURES:\n' + '\n'.join(failures) if failures else '\nALL PASSED')
sys.exit(1 if failures else 0)
