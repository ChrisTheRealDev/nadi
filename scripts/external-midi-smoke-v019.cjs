const assert = require('node:assert/strict');
const { playwright, createContext, setupStudio, fixture, importFile } = require('./benchmark-v019.cjs');
const { DEMO_ORIGIN } = require('../server/demo/config.mjs');

function fakeMidi() {
  const messages = [];
  const requests = [];
  let localStarts = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.buffer) localStarts++;
    return start.apply(this, args);
  };

  const output = Object.assign(new EventTarget(), {
    id: 'receiver-output', name: 'Fixture virtual cable', type: 'output', connection: 'open', state: 'connected',
    async open() { return this; },
    send(bytes, at) {
      if (this.state !== 'connected') throw new DOMException('Disconnected output', 'InvalidStateError');
      const message = Array.from(bytes);
      messages.push({ bytes: message, at, deliveredAt: performance.now() });
      const persisted = JSON.parse(localStorage.getItem('midi-fixture-messages') || '[]');
      localStorage.setItem('midi-fixture-messages', JSON.stringify([...persisted, message]));
    },
  });
  let busyStarts = 0, delayedStarts = 0, delayedCloses = 0, finishOpening;
  const busy = Object.assign(new EventTarget(), {
    id: 'busy-output', name: 'Busy fixture port', type: 'output', connection: 'closed', state: 'connected',
    async open() { busyStarts++; throw new DOMException('Port is busy', 'NotAllowedError'); },
    send() { throw new Error('Busy output must never receive a MIDI message'); },
  });
  const delayed = Object.assign(new EventTarget(), {
    id: 'delayed-output', name: 'Delayed fixture port', type: 'output', connection: 'closed', state: 'connected',
    async open() { delayedStarts++; await new Promise(resolve => { finishOpening = resolve; }); this.connection = 'open'; return this; },
    async close() { delayedCloses++; this.connection = 'closed'; return this; },
    send() { throw new Error('Stale output must never receive a MIDI message'); },
  });
  const input = (id, name) => Object.assign(new EventTarget(), {
    id, name, type: 'input', connection: 'open', state: 'connected', onmidimessage: null,
  });
  const cableReturn = input('receiver-input', output.name);
  const keyboard = input('keyboard-input', 'Fixture keyboard');
  const access = Object.assign(new EventTarget(), {
    inputs: new Map([[cableReturn.id, cableReturn], [keyboard.id, keyboard]]),
    outputs: new Map([[output.id, output], [busy.id, busy], [delayed.id, delayed]]),
  });
  Object.defineProperty(navigator.permissions, 'query', { value: async () => ({ state: 'prompt' }) });
  Object.defineProperty(navigator, 'requestMIDIAccess', { value: async options => {
    requests.push({ sysex: options.sysex, activation: navigator.userActivation.isActive });
    return access;
  } });
  window.externalMidiFixture = {
    messages, requests,
    busyStarts: () => busyStarts,
    delayedStarts: () => delayedStarts,
    delayedOpening: () => !!finishOpening,
    finishOpening: () => finishOpening(),
    delayedCloses: () => delayedCloses,
    localStarts: () => localStarts,
    inputAttached: () => ({ cableReturn: !!cableReturn.onmidimessage, keyboard: !!keyboard.onmidimessage }),
    playInput: () => {
      keyboard.onmidimessage?.({ data: new Uint8Array([0x90, 67, 100]), timeStamp: performance.now() });
      keyboard.onmidimessage?.({ data: new Uint8Array([0x80, 67, 0]), timeStamp: performance.now() });
    },
    disconnect: () => {
      output.state = 'disconnected';
      const changed = Object.assign(new Event('statechange'), { port: output });
      access.dispatchEvent(changed);
      access.onstatechange?.(changed);
    },
  };
}

async function setupRoutedProject(page, origin) {
  await setupStudio(page, origin);
  const project = fixture(false);
  project.tracks.length = 1;
  project.patterns.length = 1;
  project.clips.length = 1;
  project.name = 'External MIDI browser fixture';
  await importFile(page, 'midi-fixture.json', Buffer.from(JSON.stringify(project)));

  const settings = page.locator('.sw-settings > summary');
  const field = name => page.locator('.sw-settings label').filter({ hasText: new RegExp('^' + name) }).locator('select');
  const output = field('MIDI output');
  const play = page.getByRole('button', { name: 'Play song', exact: true });
  const stop = page.locator('.sw-transport').getByRole('button', { name: /Stop$/ });
  const messageCount = () => page.evaluate(() => window.externalMidiFixture.messages.length);
  await settings.click();
  await page.getByText('External MIDI instrument', { exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.externalMidiFixture.requests), []);
  await page.getByRole('button', { name: 'Find MIDI outputs', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.externalMidiFixture.requests), [{ sysex: false, activation: true }]);
  assert.equal(await output.inputValue(), '');
  await output.selectOption('receiver-output');
  await field('MIDI channel').selectOption('3');
  await field('Route track').selectOption('piano');
  assert.equal(await page.getByLabel('Also play the NADI sound').isChecked(), false);
  await page.getByText('Piano → Fixture virtual cable · Channel 3', { exact: true }).waitFor();
  return { settings, field, output, play, stop, messageCount };
}

async function smoke(page, origin) {
  const { settings, field, output, play, stop, messageCount } = await setupRoutedProject(page, origin);

  await page.getByRole('button', { name: 'Connect MIDI', exact: true }).click();
  await page.waitForFunction(() => window.externalMidiFixture.inputAttached().keyboard);
  assert.equal(await page.evaluate(() => window.externalMidiFixture.inputAttached().cableReturn), false);
  await settings.click();
  await page.evaluate(() => window.externalMidiFixture.playInput());
  assert.equal(await messageCount(), 0, 'Incoming MIDI must not echo to the external output');

  await play.click();
  await page.waitForFunction(() => window.externalMidiFixture.messages.some(item => item.bytes?.[0] === 0x92 && item.bytes[1] === 59));
  await page.waitForFunction(() => window.externalMidiFixture.messages.some(item => item.bytes?.[0] === 0x82 && item.bytes[1] === 59));
  await stop.evaluate(button => button.click());
  const beforeWait = await messageCount();
  await page.waitForTimeout(850);
  const arranged = await page.evaluate(() => window.externalMidiFixture.messages);
  assert(arranged.every(item => (item.bytes[0] & 0x0f) === 2), 'All arrangement messages use channel 3');
  assert(arranged.every(item => item.at === undefined || item.at <= item.deliveredAt + 2), 'The device never holds an uncancellable future send');
  assert.equal(arranged.length, beforeWait, 'Stop cancels any following note');

  await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
  const key = page.locator('[id="work-panel-keyboard"]').getByRole('button', { name: /^Play / }).first();
  const prior = await messageCount();
  await key.hover();
  await page.mouse.down();
  await page.waitForFunction(startIndex => window.externalMidiFixture.messages.slice(startIndex).some(item => item.bytes?.[0] === 0x92), prior);
  await stop.evaluate(button => button.click());
  await page.waitForFunction(startIndex => window.externalMidiFixture.messages.slice(startIndex).some(item => item.bytes?.[0] === 0x82), prior);
  await page.mouse.up();

  await settings.click();
  const section = page.getByText('External MIDI instrument', { exact: true });
  if (!await output.isVisible()) await section.click();
  await output.selectOption('');
  const beforeLocal = await messageCount();
  const audioBefore = await page.evaluate(() => window.externalMidiFixture.localStarts());
  await settings.click();
  await play.click();
  await page.waitForFunction(count => window.externalMidiFixture.localStarts() > count, audioBefore);
  await stop.click();
  assert.equal(await messageCount(), beforeLocal, 'Off returns playback to NADI only');

  await settings.click();
  if (!await output.isVisible()) await section.click();
  await output.selectOption('busy-output');
  await page.getByText(/^Could not open Busy fixture port/).waitFor();
  await page.getByRole('button', { name: 'Retry MIDI output' }).click();
  await page.waitForFunction(() => window.externalMidiFixture.busyStarts() === 2);
  await page.getByText(/^Could not open Busy fixture port/).waitFor();
  const beforeBusyPlayback = await messageCount();
  const localBeforeBusy = await page.evaluate(() => window.externalMidiFixture.localStarts());
  await settings.click(); await play.click();
  await page.waitForFunction(count => window.externalMidiFixture.localStarts() > count, localBeforeBusy);
  await stop.click();
  assert.equal(await messageCount(), beforeBusyPlayback, 'Busy ports leave transport on NADI sound');

  await settings.click();
  if (!await output.isVisible()) await section.click();
  await output.selectOption('delayed-output');
  await page.getByText('Opening Delayed fixture port…', { exact: true }).waitFor();
  await page.waitForFunction(() => window.externalMidiFixture.delayedOpening());
  await output.selectOption('receiver-output');
  await page.getByText('Piano → Fixture virtual cable · Channel 3', { exact: true }).waitFor();
  await page.evaluate(() => window.externalMidiFixture.finishOpening());
  await page.waitForFunction(() => window.externalMidiFixture.delayedCloses() === 1);
  await page.getByText('Piano → Fixture virtual cable · Channel 3', { exact: true }).waitFor();
  await page.evaluate(() => window.externalMidiFixture.disconnect());
  await page.getByText(/^MIDI output disconnected/).waitFor();
  assert.equal(await output.inputValue(), '');
  await settings.click();
  const countAfterDisconnect = await messageCount();
  const audioAfterDisconnect = await page.evaluate(() => window.externalMidiFixture.localStarts());
  await play.click();
  await page.waitForFunction(count => window.externalMidiFixture.localStarts() > count, audioAfterDisconnect);
  await stop.click();
  assert.equal(await messageCount(), countAfterDisconnect, 'Disconnect restores local playback without further output');

  await settings.click();
  if (!await output.isVisible()) await section.click();
  await output.selectOption('delayed-output');
  await page.waitForFunction(() => window.externalMidiFixture.delayedStarts() === 2);
  await page.evaluate(() => { location.hash = 'progress'; });
  await settings.waitFor({ state: 'detached' });
  await page.evaluate(() => { location.hash = 'create'; });
  await settings.click(); await section.click();
  await page.getByRole('button', { name: 'Find MIDI outputs', exact: true }).click();
  await output.selectOption('delayed-output');
  await field('Route track').selectOption('piano');
  assert.equal(await page.evaluate(() => window.externalMidiFixture.delayedStarts()), 2, 'Remount waits for the same port’s pending cleanup');
  await page.evaluate(() => window.externalMidiFixture.finishOpening());
  await page.waitForFunction(() => window.externalMidiFixture.delayedCloses() === 2 && window.externalMidiFixture.delayedStarts() === 3);
  await page.evaluate(() => window.externalMidiFixture.finishOpening());
  await page.getByText('Piano → Delayed fixture port · Channel 1', { exact: true }).waitFor();
}

async function blockedSamplesAndPageExit(browser, origin) {
  const context = await createContext(browser);
  await context.addInitScript(fakeMidi);
  const page = await context.newPage();
  page.setDefaultTimeout(16000);
  // Block bundled sample loading before the studio can warm a selected track.
  await page.route('**/audio/**', route => route.fulfill({ status: 503, body: 'Fixture audio unavailable' }));
  const { settings, play, stop, messageCount } = await setupRoutedProject(page, origin);
  await settings.click();
  await play.click();
  await page.waitForFunction(() => window.externalMidiFixture.messages.some(item => item.bytes[0] === 0x92));
  assert.equal(await page.evaluate(() => window.externalMidiFixture.localStarts()), 0);
  await stop.click();

  await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
  const key = page.locator('#work-panel-keyboard').getByRole('button', { name: /^Play / }).first();
  await page.locator('.sw-transport [data-help-target="record"]').click();
  await page.locator('.sw-record.is-recording').filter({ hasText: 'Recording' }).waitFor();
  const recordMessages = await messageCount();
  await key.hover(); await page.mouse.down(); await page.waitForTimeout(130); await page.mouse.up();
  await page.waitForFunction(index => window.externalMidiFixture.messages.slice(index).some(item => item.bytes[0] === 0x92 && item.bytes[1] === 48), recordMessages);
  await stop.click();
  const take = page.getByRole('region', { name: 'Recorded take' });
  await take.getByRole('button', { name: 'Discard recording', exact: true }).click();
  await take.waitFor({ state: 'hidden' });

  const prior = await messageCount();
  await key.hover(); await page.mouse.down();
  await page.waitForFunction(index => window.externalMidiFixture.messages.slice(index).some(item => item.bytes[0] === 0x92 && item.bytes[1] === 48), prior);
  await page.reload();
  const delivered = await page.evaluate(() => JSON.parse(localStorage.getItem('midi-fixture-messages')));
  assert.deepEqual(delivered.slice(-2).map(item => item.slice(0, 2)), [[0x92, 48], [0x82, 48]], 'Reload releases the held external pitch');

  await page.mouse.up();
  const nextRoute = await setupRoutedProject(page, origin);
  await nextRoute.settings.click();
  if (!await key.isVisible()) await page.getByRole('button', { name: 'Keyboard', exact: true }).click();
  const observer = await context.newPage();
  await observer.goto(origin + '/#progress');
  const beforeClose = await nextRoute.messageCount();
  await page.bringToFront(); await key.hover(); await page.mouse.down();
  await page.waitForFunction(index => window.externalMidiFixture.messages.slice(index).some(item => item.bytes[0] === 0x92 && item.bytes[1] === 48), beforeClose);
  await page.close({ runBeforeUnload: true });
  await observer.waitForFunction(() => {
    const last = JSON.parse(localStorage.getItem('midi-fixture-messages')).at(-1);
    return last?.[0] === 0x82 && last?.[1] === 48;
  });
  await context.close();
}

async function main() {
  const origin = process.argv[2] ?? DEMO_ORIGIN;
  assert.equal(new URL(origin).hostname, '127.0.0.1', 'Expected isolated loopback preview');
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  try {
    const context = await createContext(browser);
    await context.addInitScript(fakeMidi);
    const page = await context.newPage();
    page.setDefaultTimeout(16000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await smoke(page, origin);
    assert.deepEqual(errors, []);
    await context.close();
    await blockedSamplesAndPageExit(browser, origin);
    console.log('PASS mocked Web MIDI in Chrome: gesture-only access, explicit open and retry, stale port cleanup across remount, channel 3, loopback suppression, Stop, Off, disconnect, reload and tab-close release, and external playback and recording with unavailable built-in samples');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
