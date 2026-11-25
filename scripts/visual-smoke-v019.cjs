// Visual regression checks against a local NADI preview and fictional fixtures.
// Contrast checks use the composited CSS background colors. Screenshots show the finished paint.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const playwright = require('playwright');
const { DEMO_ORIGIN } = require('../server/demo/config.mjs');

const origin = new URL(process.env.NADI_TEST_URL || DEMO_ORIGIN);
assert.equal(origin.hostname, '127.0.0.1', 'The smoke test runs on loopback');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nadi-v020-visual-'));
const themeModes = ['light', 'eclipse', 'dark'];
const viewports = [1440, 768, 390];
const actor = { id: '44444444-4444-4444-8444-444444444444', display_name: 'Fixture tutor', role: 'mentor' };
const ratios = [];

async function ratio(locator, label) {
  await locator.waitFor({ state: 'visible' });
  const result = await locator.evaluate(element => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    function pixel(css) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    }
    function over([r, g, b, a], under) {
      return [a*r + (1-a)*under[0], a*g + (1-a)*under[1], a*b + (1-a)*under[2]];
    }
    function luminance(rgb) {
      const [r, g, b] = rgb.map(channel => {
        const v = channel / 255;
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      });
      return .2126*r + .7152*g + .0722*b;
    }
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      layers.push(pixel(getComputedStyle(node).backgroundColor));
    }
    const bg = layers.reverse().reduce((base, color) => over(color, base), [255, 255, 255]);
    const fg = over(pixel(getComputedStyle(element).color), bg);
    const [lo, hi] = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
    return { ratio: (hi + .05) / (lo + .05), foreground: fg, background: bg };
  });
  ratios.push({ label, ...result });
  assert.ok(result.ratio >= 4.5, label + ': ' + JSON.stringify(result));
}

async function background(locator) {
  return locator.evaluate(el => {
    const { backgroundColor, backgroundImage, opacity } = getComputedStyle(el);
    return [backgroundColor, backgroundImage, opacity].join(' ');
  });
}

async function focus(locator) {
  await locator.page().keyboard.press('Tab');
  await locator.focus();
  const outline = await locator.evaluate(el => {
    const style = getComputedStyle(el);
    return [el.matches(':focus-visible'), style.outlineStyle, parseFloat(style.outlineWidth)];
  });
  assert.ok(outline[0] && outline[1] !== 'none' && outline[2] >= 2, 'Visible keyboard outline: ' + outline);
}

async function checkViewport(page) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(result.scroll <= result.width + 1, 'Page overflows: ' + JSON.stringify(result));
}

async function shot(page, scene, theme, width) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, [scene, theme, width].join('-') + '.png') });
}

async function runStudio(page) {
  await page.addInitScript(() => localStorage.setItem('nadi.layout-first-intro.v3', 'seen'));
  await page.route('**/api/v1/**', route => route.fulfill({ json: { configured: false } }));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(new URL('/#create', origin).href);
  await page.locator('.sw-selector').waitFor();
  const fontLoaded = await page.evaluate(async () => {
    const faces = await document.fonts.load('400 16px "Nadi Nunito Sans"');
    return faces.some(face => face.status === 'loaded');
  });
  assert.ok(fontLoaded, 'Chrome must load the bundled Nunito Sans face');
  await page.getByRole('button', { name: /^Place C4 at bar/ }).click();
  await page.getByText('Autosaved', { exact: true }).first().waitFor();
  for (const theme of themeModes) {
    await page.getByRole('combobox', { name: 'Appearance' }).selectOption(theme);
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await checkViewport(page);
      const play = page.getByRole('button', { name: 'Play song', exact: true });
      const record = page.locator('[data-help-target="record"]');
      const project = page.locator('[data-sw-menu="project"] > summary');
      const score = page.locator('.nadi-score-link');
      await play.scrollIntoViewIfNeeded();
      await ratio(play, 'Play ' + theme + ' ' + width);
      await ratio(record, 'Record ' + theme + ' ' + width);
      await ratio(page.locator('.sw-save-state'), 'Save state ' + theme + ' ' + width);
      assert.equal(await page.locator('.sw-transport').evaluate(el => getComputedStyle(el).backdropFilter), 'none');
      const actionColors = await Promise.all([
        page.locator('.nadi-work-link'), play, record, page.getByRole('button', { name: /Stop$/ }),
        page.locator('[data-panel-button="notes"][aria-pressed="true"]'),
        page.locator('.sw-undo-group button:disabled').first(),
      ].map(background));
      assert.equal(new Set(actionColors).size, actionColors.length, 'Action, selected and disabled styles distinguishable');
      await ratio(page.locator('[data-help-target="save-project"]'), 'Save ' + theme + ' ' + width);
      await focus(project);
      await shot(page, 'studio', theme, width);

      await project.click();
      await page.getByRole('button', { name: 'Open saved project', exact: true }).waitFor();
      await project.click();
      await score.click();
      const paper = page.locator('.nadi-score-pages svg').first();
      await paper.waitFor({ timeout: 30000 });
      await page.waitForFunction(() => {
        const paper = document.querySelector('.nadi-score-pages svg');
        const work = document.querySelector('.nadi-score-workarea');
        return paper && work && paper.getBoundingClientRect().top < work.getBoundingClientRect().bottom;
      }, undefined, { timeout: 10000 });
      await checkViewport(page);
      await ratio(page.locator('.nadi-score-header h2'), 'Score title ' + theme + ' ' + width);
      const print = page.getByRole('button', { name: 'Print / Save PDF', exact: true });
      await ratio(print, 'Score print ' + theme + ' ' + width);
      await focus(page.getByRole('button', { name: 'Close sheet music' }));
      await shot(page, 'score', theme, width);
      await page.getByRole('button', { name: 'Close sheet music' }).click();
    }
  }
  await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
  const record = page.locator('[data-help-target="record"]');
  await record.click();
  await record.filter({ hasText: 'Recording' }).waitFor({ timeout: 20000 });
  await ratio(record, 'Active recording');
  const key = page.getByRole('button', { name: 'Play A3', exact: true });
  await key.hover();
  await page.mouse.down();
  await page.waitForTimeout(180);
  await page.mouse.up();
  await page.getByRole('button', { name: /Stop$/ }).click();
  const keep = page.getByRole('button', { name: 'Keep recording', exact: true });
  await ratio(keep, 'Keep recording');
  const discard = page.getByRole('button', { name: 'Discard recording', exact: true });
  assert.ok((await keep.boundingBox()).height >= 44, 'Keep action has a touch-sized target');
  await ratio(discard, 'Discard recording');
  assert.notEqual(await background(keep), await background(discard));
  await shot(page, 'recorded-take', 'dark', 390);
  await keep.click();
}

async function runPortal(page) {
  await page.route('**/api/v1/**', route => {
    const { pathname } = new URL(route.request().url());
    const json = pathname.endsWith('/status') ? { configured: true, reason: 'Fictional fixture' }
      : pathname.endsWith('/auth/login') ? { accessToken: 'fixture', refreshToken: 'fixture-refresh', expiresIn: 3600 }
      : pathname.endsWith('/workspace') ? { profile: actor, disclosureAccepted: true, musicSharingAccepted: true, learners: [] }
      : { projects: [], revisions: [], exchanges: [], threads: [] };
    return route.fulfill({ json });
  });
  await page.goto(new URL('/#progress', origin).href);
  for (const theme of themeModes) {
    await page.locator('#tp-theme').selectOption(theme);
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await checkViewport(page);
      const signIn = page.getByRole('button', { name: 'Sign in', exact: true });
      await ratio(page.getByRole('heading', { name: 'Welcome to NADI' }), 'Sign-in title ' + theme + ' ' + width);
      await ratio(signIn, 'Sign in ' + theme + ' ' + width);
      const recovery = page.getByRole('button', { name: 'Forgot password?', exact: true });
      await ratio(recovery, 'Recovery link ' + theme + ' ' + width);
      assert.notEqual(await background(signIn), await background(recovery));
      await focus(signIn);
      await signIn.hover();
      await ratio(signIn, 'Sign-in hover ' + theme + ' ' + width);
      await page.mouse.down();
      await ratio(signIn, 'Sign-in pressed ' + theme + ' ' + width);
      await page.mouse.up();
      await shot(page, 'sign-in', theme, width);
    }
  }
  await page.getByLabel('Email', { exact: true }).fill('fixture@nadi.example');
  await page.getByLabel('Password', { exact: true }).fill('isolated-fixture');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Learners', exact: true }).waitFor();
  for (const theme of themeModes) {
    await page.locator('#tp-theme').selectOption(theme);
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      await checkViewport(page);
      await ratio(page.getByRole('heading', { name: 'Learners', exact: true }), 'Tutor title ' + theme + ' ' + width);
      const assignment = page.getByRole('button', { name: 'Create assignment', exact: true });
      const refresh = page.getByRole('button', { name: 'Refresh planner', exact: true });
      await ratio(assignment, 'Create assignment ' + theme + ' ' + width);
      await ratio(refresh, 'Refresh planner ' + theme + ' ' + width);
      assert.notEqual(await background(assignment), await background(refresh));
      assert.ok(await refresh.evaluate(el => parseFloat(getComputedStyle(el).borderRadius) > 0));
      await shot(page, 'tutor', theme, width);
    }
  }
}

(async () => {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  try {
    const errorMessages = [];
    for (const verify of [runStudio, runPortal]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on('pageerror', error => errorMessages.push(error.message));
      try { await verify(page); } finally { await context.close(); }
    }
    assert.deepEqual(errorMessages, []);
    const lowest = ratios.sort((a, b) => a.ratio - b.ratio)[0];
    console.log(JSON.stringify({ browser: browser.version(), output, assertions: ratios.length, lowest }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

