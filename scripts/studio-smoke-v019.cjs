const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { playwright, createContext, fixture, setupStudio, importFile, scoreButton, closeScore, serveDist } = require('./benchmark-v019.cjs');
const { DEMO_ORIGIN } = require('../server/demo/config.mjs');

async function readProject(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('nadi-creation-v1');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(['meta', 'projects'], 'readonly');
      const active = tx.objectStore('meta').get('last-active-project-id');
      let data;
      active.onsuccess = () => {
        if (active.result) {
          const project = tx.objectStore('projects').get(active.result);
          project.onsuccess = () => { data = project.result; };
        }
      };
      tx.oncomplete = () => { db.close(); resolve(data); };
      tx.onabort = () => reject(tx.error);
    };
  }));
}

async function download(page, button, exportMenu = false) {
  const menu = page.locator('.export-menu');
  if (exportMenu && !await menu.evaluate(element => element.open)) await menu.locator('summary').click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const bytes = await fs.readFile(await (await pending).path());
  if (exportMenu && await menu.evaluate(element => element.open)) await menu.locator('summary').click();
  return bytes;
}

async function record(page, keep) {
  await page.locator('.sw-transport [data-help-target="record"]').click();
  await page.locator('.sw-record.is-recording').filter({ hasText: 'Recording' }).waitFor();
  const key = page.locator('[id="work-panel-keyboard"]').getByRole('button', { name: /^Play / }).first();
  await key.hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.locator('.sw-transport').getByRole('button', { name: /Stop$/ }).click();
  const take = page.getByRole('region', { name: 'Recorded take' });
  await take.getByRole('button', { name: keep ? 'Keep recording' : 'Discard recording', exact: true }).click();
  await take.waitFor({ state: 'hidden' });
}

async function testStudio(browser, origin, priorArchive) {
  const context = await createContext(browser);
  await context.addInitScript(() => {
    window.fixtureMidi = [];
    Object.defineProperty(navigator.permissions, 'query', { value: async () => ({ state: 'prompt' }) });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => {
        window.fixtureMidi.push(navigator.userActivation.isActive);
        return { inputs: new Map(), outputs: new Map(), addEventListener() {}, removeEventListener() {} };
      },
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(18000);
  const errors = [], wavRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('.flac')) wavRequests.push(response); });
  const autosaved = () => page.locator('.sw-save-state').filter({ hasText: /^Autosaved$/ }).waitFor();
  try {
    await setupStudio(page, origin);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await autosaved();
    await page.getByRole('button', { name: /^Place .* at bar 1 beat 1$/ }).click();
    await autosaved();
    const fresh = await readProject(page);
    assert.equal(fresh.patterns[0].notes.length, 1);
    await page.reload();
    await autosaved();
    assert.deepEqual(await readProject(page), fresh);
    assert.deepEqual(await page.evaluate(() => window.fixtureMidi), [], 'No automatic MIDI permission request');
    await page.locator('.sw-settings > summary').click();
    await page.getByRole('button', { name: 'Connect MIDI', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureMidi), [true], 'Permission request uses a genuine click');
    await page.locator('.sw-settings > summary').click();
    console.log('PASS create, place note, autosave, reload, and explicit MIDI permission');
    await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
    await record(page, true);
    await autosaved();
    const kept = await readProject(page);
    assert.equal(kept.patterns[0].notes.length, fresh.patterns[0].notes.length + 1);
    assert.deepEqual(kept.ideas.at(-1).original.events.map(event => event.type), ['note-on', 'note-off']);
    await record(page, false);
    assert.deepEqual(await readProject(page), kept);
    await page.getByRole('button', { name: 'Play song', exact: true }).click();
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await page.locator('.sw-transport').getByRole('button', { name: /Stop$/ }).click();
    const midi = await download(page, 'MIDI notes (.mid)', true);
    assert.equal(midi.toString('ascii', 0, 4), 'MThd');
    const wav = await download(page, 'Audio (.wav)', true);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert(wav.subarray(44).some(value => value), 'Piano WAV samples have audible signal data');
    assert(wavRequests.some(response => response.ok() && response.headers()['content-type'] === 'audio/flac'), 'FLAC served with playable MIME');
    console.log('PASS keep/discard, playback, real piano FLAC fetch, WAV and MIDI exports');
    await page.getByRole('button', { name: 'Mira AI assistant', exact: true }).click();
    const help = page.getByRole('complementary', { name: 'Mira help' });
    await help.getByText('Things I can help with', { exact: true }).click();
    await help.getByRole('button', { name: 'Save or download', exact: true }).click();
    await help.locator('.studio-mira-action').filter({ hasText: /^Open Export/ }).waitFor();
    assert.match(await help.locator('.mira-source').innerText(), /^Built-in help/);
    await help.getByRole('button', { name: 'Close help', exact: true }).click();
    console.log('PASS built-in Mira help without live API credentials');
    if (priorArchive) {
      await importFile(page, 'from-v018.nadi', priorArchive);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await autosaved();
      const prior = fixture(false);
      const imported = await readProject(page);
      assert.deepEqual(imported.patterns, prior.patterns);
      assert.deepEqual(imported.ideas, prior.ideas);
      console.log('PASS v018 .nadi artifact opens with original capture and notes byte-for-byte at field level');
    } else {
      await importFile(page, 'fixture.json', Buffer.from(JSON.stringify(fixture(false))));
    }
    await scoreButton(page).click();
    await page.locator('.nadi-score-pages svg').first().waitFor();
    await page.getByLabel('Score', { exact: true }).selectOption('piano');
    await page.locator('.nadi-score-info [role=status]').filter({ hasText: /^1 part/ }).waitFor();
    const xml = await download(page, 'Download MusicXML');
    assert.match(xml.toString(), /<score-partwise/);
    assert.match(xml.toString(), /<part-name>Piano<\/part-name>/);
    await page.evaluate(() => {
      window.fixturePrint = 0;
      const appendChild = document.body.appendChild.bind(document.body);
      document.body.appendChild = node => {
        const result = appendChild(node);
        if (node.tagName === 'IFRAME') node.contentWindow.print = () => { window.fixturePrint++; };
        return result;
      };
    });
    await page.locator('.nadi-score-primary').click();
    await page.waitForFunction(() => window.fixturePrint === 1);
    assert((await page.frameLocator('iframe[title="Print sheet music"]').locator('svg').count()) > 0);
    await closeScore(page).click();
    assert.equal(await page.locator('#root').evaluate(element => element.inert), false);
    const archive = await download(page, 'NADI project (.nadi)', true);
    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.deepEqual(errors, []);
    console.log('PASS full/individual SVG score, MusicXML, print rendering, focus/inert cleanup, and .nadi export');
    return archive;
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await playwright.chromium.launch({
    channel: 'chrome', headless: true, args: ['--mute-audio', '--autoplay-policy=no-user-gesture-required'],
  });
  const origin = process.argv[2] || process.env.NADI_TEST_URL || DEMO_ORIGIN;
  const file = process.argv[3];
  const isUrl = /^https?:\/\//.test(origin);
  if (isUrl) assert.equal(new URL(origin).hostname, '127.0.0.1', 'Expected isolated loopback preview');
  const server = isUrl ? null : await serveDist(origin);
  try {
    const archive = await testStudio(browser, server?.origin || origin, isUrl && file ? await fs.readFile(file) : undefined);
    if (!isUrl && file) await fs.writeFile(file, archive, { flag: 'wx' });
  } finally {
    await browser.close();
    await server?.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
