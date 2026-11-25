const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { DEMO_ORIGIN } = require('../server/demo/config.mjs');
const { playwright, createContext, fixture, setupStudio, importFile, scoreButton, closeScore } = require('./benchmark-v019.cjs');

const origin = process.env.NADI_TEST_URL || DEMO_ORIGIN;
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Expected isolated loopback preview');

function denseProject() {
  const project = fixture(true);
  project.name = 'Fictional four-part score';
  project.bars = 128;
  for (const pattern of project.patterns) {
    pattern.lengthTicks = project.bars * 1920;
    pattern.notes = Array.from({ length: pattern.lengthTicks / 120 }, (_, index) => ({
      id: pattern.trackId + '-' + index, pitch: pattern.notes[index % 16].pitch,
      startTick: index * 120, durationTicks: 120, velocity: 90,
    }));
  }
  return project;
}

const renderButton = page => page.getByRole('button', { name: 'Render sheet music', exact: true });
const status = page => page.locator('.nadi-score-info [role=status]');

async function openDense(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await setupStudio(page, origin);
  await importFile(page, 'dense-score.json', Buffer.from(JSON.stringify(denseProject())));
  await scoreButton(page).click();
  await renderButton(page).waitFor();
  assert.match(await status(page).innerText(), /large score/);
  assert.equal(await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.nadi-score-pages svg').count(), 0);
  return page;
}

async function cancelDuringLibraryLoad(browser) {
  const context = await createContext(browser);
  let resume;
  const hold = new Promise(resolve => { resume = resolve; });
  try {
    await context.route('**/*opensheetmusicdisplay*', async route => {
      await hold;
      await route.continue();
    });
    const page = await openDense(context);
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await renderButton(page).waitFor();
    await page.getByRole('button', { name: 'Exit full screen', exact: true }).click();
    const requested = page.waitForRequest(request => request.url().includes('opensheetmusicdisplay'));
    await renderButton(page).click();
    await requested;
    await status(page).filter({ hasText: 'Preparing sheet music' }).waitFor();
    await closeScore(page).click();
    assert.equal(await page.locator('#root').evaluate(node => node.inert), false);
    resume();
    await scoreButton(page).click();
    await renderButton(page).waitFor();
    assert.equal(await page.locator('.nadi-score-pages svg').count(), 0, 'Closed job must not attach pages to the new dialog');
    await page.keyboard.press('Escape');
    await page.locator('.nadi-score-dialog').waitFor({ state: 'hidden' });
    console.log('PASS large-score approval and cancellation while the renderer is loading');
  } finally {
    resume();
    await context.close();
  }
}

async function finishDense(browser) {
  const context = await createContext(browser);
  try {
    const page = await openDense(context);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const xmlReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download MusicXML', exact: true }).click();
    const xml = await fs.readFile(await (await xmlReady).path(), 'utf8');
    assert.match(xml, /<score-partwise/);
    assert.equal((xml.match(/<part id=/g) || []).length, 4);
    await page.getByLabel('Score', { exact: true }).selectOption('cello');
    await status(page).filter({ hasText: '1 part · 128 bars · 2048 notes' }).waitFor({ timeout: 30_000 });
    await page.getByLabel('Score', { exact: true }).selectOption('');
    await renderButton(page).waitFor();
    await page.evaluate(() => {
      window.fixtureScoreProgress = [];
      const element = document.querySelector('.nadi-score-info [role=status]');
      const progress = new MutationObserver(() => {
        const message = element.textContent;
        requestAnimationFrame(() => { window.fixtureScoreProgress.push(message); });
      });
      progress.observe(element, { childList: true, characterData: true, subtree: true });
    });
    const start = performance.now();
    await renderButton(page).click();
    await status(page).filter({ hasText: '4 parts · 128 bars · 8192 notes' }).waitFor({ timeout: 45_000 });
    const renderMs = Math.round(performance.now() - start);
    assert((await page.evaluate(() => window.fixtureScoreProgress)).some(text => text.startsWith('Engraving your sheet music')), 'Engraving status reached a browser frame');
    const pages = await page.locator('.nadi-score-pages svg').count();
    assert(pages > 1, 'Full pagination remains available');
    assert((await page.locator('.nadi-score-pages .nadi-score-note').count()) > 4000, 'Rendered notes remain interactive');
    await page.evaluate(() => {
      window.fixtureScorePrint = false;
      const append = document.body.appendChild.bind(document.body);
      document.body.appendChild = element => {
        const result = append(element);
        if (element.tagName === 'IFRAME') element.contentWindow.print = () => { window.fixtureScorePrint = true; };
        return result;
      };
    });
    await page.getByRole('button', { name: 'Print / Save PDF', exact: true }).click();
    await page.waitForFunction(() => window.fixtureScorePrint);
    assert.equal(await page.frameLocator('iframe[title="Print sheet music"]').locator('svg').count(), pages);
    await page.locator('iframe[title="Print sheet music"]').evaluate(frame => {
      frame.contentWindow.dispatchEvent(new Event('afterprint'));
    });
    await page.locator('iframe[title="Print sheet music"]').waitFor({ state: 'detached' });
    await closeScore(page).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.locator('.sw-save-state').filter({ hasText: /^Autosaved$/ });
    await saved.waitFor();
    await page.reload();
    await saved.waitFor();
    await page.locator('.sw-project-details strong').filter({ hasText: denseProject().name }).waitFor();
    const remainingNotes = await page.evaluate(() => new Promise((resolve, reject) => {
      const opening = indexedDB.open('nadi-creation-v1');
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const read = database.transaction(['meta', 'projects'], 'readonly');
        const active = read.objectStore('meta').get('last-active-project-id');
        active.onsuccess = () => {
          const project = read.objectStore('projects').get(active.result);
          project.onsuccess = () => resolve(project.result.patterns.reduce((sum, pattern) => sum + pattern.notes.length, 0));
        };
        read.oncomplete = () => database.close();
        read.onerror = () => reject(read.error);
      };
    }));
    assert.equal(remainingNotes, 8192);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ notes: 8192, pages, renderMs, readyBeforePrint: true, savedAfterClose: true }));
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const deadline = setTimeout(() => { void browser.close(); }, 150_000);
  try {
    await cancelDuringLibraryLoad(browser);
    await finishDense(browser);
    console.log('PASS score approval, cancellation, stale-job isolation, individual-part preview, full engraving, print and reload');
  } finally {
    clearTimeout(deadline);
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
