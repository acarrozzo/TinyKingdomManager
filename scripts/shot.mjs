/**
 * Looks at the game. Drives headless Chrome over the DevTools protocol: loads
 * the page, optionally loads a prepared kingdom, runs a snippet of JS in the
 * page, then captures a PNG and reports any console errors. No dependencies.
 *
 * A lot of this game can only be checked by rendering it — flat-looking roofs,
 * a button covered by an invisible element, night lighting bleeding through a
 * wall. Run the dev server first, then:
 *
 *   npm run dev
 *   node scripts/shot.mjs                                   # default view
 *   node scripts/shot.mjs http://localhost:5173/ out.png 6 "window.tkm.game.camera.zoomIndex = 3"
 *   DEVICE=390x844@3 node scripts/shot.mjs      # as a phone, with touch
 *
 * Load a mature kingdom instead of a fresh one (see `npm run sim`):
 *
 *   TKM_DUMP=k.json npm run sim -- 600
 *   PRELOAD=k.json node scripts/shot.mjs http://localhost:5173/ late.png
 *
 * `window.tkm` exposes `{ game, ui }`, so the snippet can move the camera, set
 * the season or time of day, open panels, or assert on state — whatever the
 * shot needs to show. Set CHROME to override the browser path.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.CDP_PORT || 9222);
const URL_ = process.argv[2] || 'http://localhost:5173/';
const OUT = process.argv[3] || 'shot.png';
const WAIT = Number(process.argv[4] || 6);
const SCRIPT = process.argv[5] || '';

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,950',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${process.env.TMPDIR || '/tmp'}/tkm-chrome-profile`,
    '--autoplay-policy=no-user-gesture-required',
    URL_,
  ],
  { stdio: 'ignore' },
);

let ws;
try {
  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === 'page' && t.url.includes('localhost'));
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
  }
  if (!target) throw new Error(`Nothing served at ${URL_} — is the dev server running?`);

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[${msg.params.type}] ` + msg.params.args.map((a) => a.value ?? a.description ?? '?').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ''} @${d.url}:${d.lineNumber}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') logs.push(`[${e.level}] ${e.text} ${e.url ?? ''}`);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    const ex = r.result?.exceptionDetails;
    if (ex) return `ERROR: ${ex.exception?.description ?? ex.text}`;
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // DEVICE=390x844 (optionally @3 for pixel ratio) emulates a phone or tablet,
  // touch input included — the layout and the gestures both need checking at
  // sizes the desktop window cannot show.
  if (process.env.DEVICE) {
    const m = /^(\d+)x(\d+)(?:@([\d.]+))?$/.exec(process.env.DEVICE);
    if (!m) throw new Error('DEVICE should look like 390x844 or 390x844@3');
    const [w, h, ratio] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 2)];
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: ratio,
      mobile: true,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
    console.log(`device → ${w}×${h} @${ratio}`);
  }

  await sleep(3000);

  if (process.env.PRELOAD) {
    const save = readFileSync(process.env.PRELOAD, 'utf8');
    const info = JSON.stringify([
      { id: 'preloaded', name: 'Test Kingdom', day: 1, year: 1, season: 'spring', population: 1, played: 0, savedAt: Date.now() },
    ]);
    // Seed the slot, then go through the game's own load path — no page reload,
    // so the throwaway kingdom's autosave never gets a chance to clobber it.
    console.log(
      'preload →',
      await evaluate(
        `localStorage.setItem('tkm.save.preloaded', ${JSON.stringify(save)});` +
          `localStorage.setItem('tkm.slots', ${JSON.stringify(info)});` +
          `window.tkm.ui.loadSlot('preloaded');` +
          `JSON.stringify({pop: window.tkm.game.state.villagers.length, day: window.tkm.game.state.day});`,
      ),
    );
    await sleep(800);
  }

  await sleep(WAIT * 1000);

  if (SCRIPT) console.log('script →', await evaluate(SCRIPT));
  await sleep(1500);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) {
    writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', OUT);
  } else {
    console.log('screenshot failed', JSON.stringify(shot).slice(0, 400));
  }

  const noise = logs.filter((l) => !l.includes('favicon') && !l.includes('[vite]'));
  console.log('--- console ---');
  console.log(noise.length ? noise.slice(0, 30).join('\n') : '(clean)');
} finally {
  try {
    ws?.close();
  } catch {}
  chrome.kill('SIGKILL');
}
