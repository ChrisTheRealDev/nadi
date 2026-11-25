const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const playwright = require('playwright');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.flac': 'audio/flac', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.nadi': 'application/octet-stream',
};

async function serveDist(directory) {
  const root = path.resolve(directory);
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
      if (pathname.startsWith('/api/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ configured: false, reason: 'Isolated fixture server' }));
        return;
      }
      const asset = path.resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
      if (!asset.startsWith(root + path.sep)) {
        res.writeHead(404).end();
        return;
      }
      const content = await fs.readFile(asset);
      res.writeHead(200, { 'content-type': MIME[path.extname(asset)] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve)) };
}

function fixture(dense) {
  const bars = dense ? 32 : 4;
  const tracks = (dense ? ['Piano', 'Cello', 'Clarinet', 'Flute'] : ['Piano', 'Cello']).map(name => ({
    id: name.toLowerCase(), name, color: '#658ab2', soundId: name.toLowerCase(), soundVersion: 1,
    level: 100, muted: false, hidden: false, pan: 0, space: 0, spaceBypass: false, expression: [],
  }));
  const lengthTicks = bars * 1920;
  const patterns = tracks.map(({ id: trackId }, index) => ({
    id: trackId + '-part', trackId, name: trackId, lengthTicks,
    notes: Array.from({ length: dense ? lengthTicks / 120 : bars * 2 }, (_, note) => ({
      id: trackId + '-' + note, pitch: [59, 45, 65, 71][index] + note % 7,
      startTick: note * (dense ? 120 : 960), durationTicks: dense ? 120 : 480, velocity: 90,
    })),
  }));
  return {
    format: 'nadi-creation', version: 5, id: 'bench-fixture-' + Number(dense), revision: 0,
    name: dense ? 'Fictional dense score' : 'Fictional small score', bpm: 120, bars, tracks, patterns,
    clips: patterns.map(({ trackId, id: patternId }) => ({ id: trackId + '-clip', trackId, patternId, startTick: 0 })),
    ideas: [{ id: 'original-reference', name: 'Fixture original', createdAt: '2026-09-28T00:00:00.000Z',
      attachedTick: null, original: { kind: 'text', text: '  Preserve whitespace\n\nOriginal capture.\t' } }],
    guidance: { open: false, step: 0, experience: 'new' },
  };
}

async function createContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem('nadi.layout-first-intro.v3', 'seen');
    const ready = new MutationObserver(() => {
      if (!document.querySelector('.sw-transport [data-help-target="record"]')) return;
      ready.disconnect();
      requestAnimationFrame(() => { window.nadiStudioReadyAt = performance.now(); });
    });
    ready.observe(document, { childList: true, subtree: true });
  });
  return context;
}

async function setupStudio(page, origin) {
  await page.goto(origin + '/#create', { waitUntil: 'domcontentloaded' });
  await page.locator('.sw-transport [data-help-target="record"]').waitFor();
}

async function importFile(page, name, buffer) {
  await page.locator('input[type=file][accept=".nadi,.json"]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
  await page.getByText('Opened an editable copy of your .nadi project.', { exact: false }).first().waitFor();
}

async function scoreAction(page, trigger, event, selector, expectation) {
  await page.evaluate(({ event, selector, expectation }) => {
    window.nadiMeasure = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Score did not become ready: ' + expectation)), 45000);
      const start = e => {
        if (!e.target.closest(selector)) return;
        document.removeEventListener(event, start, true);
        const started = performance.now();
        const observer = new MutationObserver(() => {
          const status = document.querySelector('.nadi-score-info [role=status]')?.textContent || '';
          if (status.includes('Preview could not render')) {
            observer.disconnect();
            clearTimeout(timeout);
            reject(new Error(status));
          }
          if (status.startsWith(expectation) && document.querySelector('.nadi-score-pages svg') &&
              !document.querySelector('.nadi-score-primary')?.disabled) {
            observer.disconnect();
            clearTimeout(timeout);
            requestAnimationFrame(() => resolve(performance.now() - started));
          }
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      };
      document.addEventListener(event, start, true);
    });
    window.nadiMeasure.catch(() => {});
  }, { event, selector, expectation });
  await trigger();
  return page.evaluate(() => window.nadiMeasure);
}

const scoreButton = page => page.getByRole('button', { name: 'Sheet music', exact: true });
const closeScore = page => page.getByRole('button', { name: 'Close sheet music', exact: true });
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const center = sorted.length / 2;
  const median = sorted.length % 2 ? sorted[Math.floor(center)] : (sorted[center - 1] + sorted[center]) / 2;
  return { samples: sorted.length, medianMs: Math.round(median), maxMs: Math.round(sorted.at(-1)) };
};

async function measureScore(browser, origin, dense) {
  const context = await createContext(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await setupStudio(page, origin);
    const project = fixture(dense);
    await importFile(page, 'fixture.json', Buffer.from(JSON.stringify(project)));
    const full = project.tracks.length + ' parts · ';
    const open = [], toPart = [], toFull = [], edit = [];
    const selector = '.nadi-score-tools select[aria-label=Score]';
    for (let i = 0; i < 5; i++) {
      open.push(await scoreAction(page, () => scoreButton(page).click(), 'click', '.sw-selector button', full));
      if (i < 4) await closeScore(page).click();
    }
    for (let i = 0; i < 10; i++) {
      toPart.push(await scoreAction(page, () => page.locator(selector).selectOption('piano'), 'change', selector, '1 part · '));
      toFull.push(await scoreAction(page, () => page.locator(selector).selectOption(''), 'change', selector, full));
    }
    assert(await page.locator('.nadi-score-pages svg').count());
    await page.getByText('Detailed notation controls', { exact: true }).click();
    const undo = page.locator('.nadi-score-direct-tools').getByRole('button', { name: 'Undo', exact: true });
    const original = await page.locator('.nadi-score-info [role=status]').innerText();
    const notes = Number(original.match(/(\d+) notes/)[1]);
    const prefix = original.slice(0, original.lastIndexOf(String(notes)));
    for (let i = 0; i < 5; i++) {
      edit.push(await scoreAction(page, () => page.getByRole('button', { name: 'Add note', exact: true }).click(), 'click', '.nadi-score-editor button', prefix + (notes + 1) + ' notes'));
      await scoreAction(page, () => undo.click(), 'click', '.nadi-score-direct-tools button', prefix + notes + ' notes');
    }
    assert.equal(await page.locator('.nadi-score-info [role=status]').innerText(), original);
    assert.deepEqual(errors, []);
    return {
      inputNotes: project.patterns.reduce((total, pattern) => total + pattern.notes.length, 0),
      firstOpenMs: Math.round(open[0]), allOpens: summary(open), switchesToPart: summary(toPart),
      switchesToFull: summary(toFull), scoreEdit: summary(edit),
    };
  } finally {
    await context.close();
  }
}

async function benchmark(browser, origin) {
  const starts = [], javascript = [];
  for (let i = 0; i < 5; i++) {
    const context = await createContext(browser);
    try {
      const page = await context.newPage();
      await setupStudio(page, origin);
      await page.waitForFunction(() => Number.isFinite(window.nadiStudioReadyAt));
      const sample = await page.evaluate(() => {
        const scripts = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.endsWith('.js'));
        return { startupMs: window.nadiStudioReadyAt, jsBytes: scripts.reduce((size, entry) => size + entry.transferSize, 0) };
      });
      starts.push(sample.startupMs);
      javascript.push(sample.jsBytes);
    } finally {
      await context.close();
    }
  }
  const result = { browser: browser.version(), coldStartup: summary(starts), initialJsTransferBytes: javascript };
  for (const dense of [false, true]) result[dense ? 'dense' : 'small'] = await measureScore(browser, origin, dense);
  return result;
}

async function main() {
  const directories = process.argv.slice(2);
  assert(directories.length, 'Usage: node scripts/benchmark-v019.cjs <dist-directory> [<dist-directory> ...]');
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  try {
    for (const directory of directories) {
      const server = await serveDist(directory);
      try {
        const result = await benchmark(browser, server.origin);
        console.log(JSON.stringify({ directory, ...result }, null, 2));
      } finally {
        await server.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { playwright, createContext, fixture, setupStudio, importFile, scoreButton, closeScore, serveDist };
