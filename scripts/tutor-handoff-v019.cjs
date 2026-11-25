// Fictional student and tutor exercise the actual UI against an isolated HTTP fixture.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const { DEMO_ORIGIN } = require('../server/demo/config.mjs');

const origin = new URL(process.env.NADI_TEST_URL || DEMO_ORIGIN);
assert.equal(origin.hostname, '127.0.0.1', 'The smoke test runs on loopback');
const student = { id: '11111111-1111-4111-8111-111111111111', display_name: 'Fixture student', role: 'student' };
const mentor = { id: '22222222-2222-4222-8222-222222222222', display_name: 'Fixture tutor', role: 'mentor' };
const progress = { learnerId: student.id, goals: [], workSessions: [], events: [], checkpoints: [], feedback: [], helpRequests: [] };
const projectName = 'Fixture composition saved offline';
const message = 'Try a softer ending in this revision.';
const threadId = '33333333-3333-4333-8333-333333333333';

async function run() {
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  const revisions = [], threads = [], attempted = [], errors = [];
  let outage = true;

  async function login(profile) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/api/v1/**', async route => {
      const request = route.request();
      const { pathname, searchParams } = new URL(request.url());
      const reply = (json, status = 200) => route.fulfill({ json, status });
      if (pathname.endsWith('/status')) return reply({ configured: true, reason: 'Fictional fixture' });
      if (pathname.endsWith('/auth/login')) return reply({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600 });
      if (pathname.endsWith('/workspace')) return reply({ profile, disclosureAccepted: true, musicSharingAccepted: true, learners: [{ profile: student, progress }] });
      if (pathname.endsWith('/feedback')) return reply({ items: [] });
      if (pathname.endsWith('/planner')) return reply({ goals: [], steps: [], reviews: [] });
      if (pathname.endsWith('/shared') && request.method() === 'GET') {
        const latest = revisions.at(-1);
        const projects = latest ? [{ project_id: latest.manifest.id, name: latest.manifest.name, revision: latest.revision, updated_at: latest.received_at }] : [];
        return reply({ projects, revisions: searchParams.has('projectId') ? [...revisions].reverse() : [], exchanges: [], threads });
      }
      if (pathname.endsWith('/shared')) {
        const { kind, payload } = request.postDataJSON();
        if (kind === 'revision' && profile === student) {
          if (payload.manifest.name === projectName) {
            attempted.push(payload.mutationId);
            if (outage) return route.abort('internetdisconnected');
          }
          const existing = revisions.find(row => row.mutationId === payload.mutationId);
          if (existing) return reply({ revision: existing.revision, snapshotId: existing.id });
          assert.equal(payload.expectedRevision, revisions.length);
          const saved = { id: 'snapshot-' + (revisions.length + 1), revision: revisions.length + 1, manifest: payload.manifest, mutationId: payload.mutationId, received_at: new Date().toISOString() };
          revisions.push(saved);
          return reply({ revision: saved.revision, snapshotId: saved.id });
        }
        if (kind === 'comment' && profile === mentor) {
          assert.equal(payload.snapshotId, revisions.at(-1).id);
          threads.push({ id: threadId, snapshot_id: payload.snapshotId, message: payload.message, anchor: payload.anchor, resolved_at: null, replies: [] });
          return reply({ threadId });
        }
        errors.push('Unexpected shared command for ' + profile.role + ': ' + kind);
        return reply({ error: 'Fixture command denied' }, 403);
      }
      errors.push('Unexpected fixture path ' + pathname);
      return reply({ error: 'Fixture route unavailable' }, 404);
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('/#progress', origin).href);
    await page.getByLabel('Email', { exact: true }).fill(profile.role + '@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fictional-browser-test');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    return page;
  }

  try {
    const learnerPage = await login(student);
    await learnerPage.getByRole('link', { name: 'Open account studio' }).click();
    await learnerPage.getByRole('button', { name: 'Save', exact: true }).click();
    await learnerPage.getByText('Saved in this browser. Download .nadi as a portable backup.').waitFor();
    await learnerPage.locator('.file-menu > summary').click();
    const title = learnerPage.getByLabel('Project name', { exact: true });
    await title.fill(projectName);
    await title.press('Tab');
    await learnerPage.getByText(/Shared with your tutor · error/).first().waitFor({ timeout: 25_000 });
    assert.ok(attempted.length);
    assert.equal(revisions.some(row => row.manifest.name === projectName), false);
    outage = false;
    await learnerPage.getByText(/Shared with your tutor · synced/).first().waitFor({ timeout: 25_000 });
    const saved = revisions.filter(row => row.manifest.name === projectName);
    assert.equal(saved.length, 1);
    assert.deepEqual([...new Set(attempted)], [saved[0].mutationId]);

    const tutorPage = await login(mentor);
    await tutorPage.getByRole('button', { name: /Fixture student/ }).click();
    const review = tutorPage.locator('.tp-review');
    await review.locator('select').first().selectOption(saved[0].manifest.id);
    await review.getByRole('button', { name: 'Open latest saved composition' }).click();
    await review.getByRole('region', { name: 'Saved composition view' }).waitFor();
    assert.equal(await review.getByLabel('Project name', { exact: true }).count(), 0);
    await review.getByLabel('Comment', { exact: true }).fill(message);
    await review.getByRole('button', { name: 'Send comment' }).click();
    await review.getByRole('status').filter({ hasText: 'Comment sent and confirmed' }).waitFor();
    assert.equal(threads.length, 1);

    await learnerPage.getByRole('link', { name: /My work & tutor feedback/ }).click();
    const studentReview = learnerPage.locator('.tp-review');
    await studentReview.locator('select').first().selectOption(saved[0].manifest.id);
    await studentReview.getByText(message, { exact: true }).waitFor();
    assert.equal(await studentReview.getByRole('button', { name: 'Send comment' }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: student edit retried with its original mutation ID, tutor reviewed and commented, student received the comment.');
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
