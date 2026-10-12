const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createWebApplication } = require('./web-app.cjs');

test('single-port deployment serves SPA routes and assets while preserving API responses', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skynest-web-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>SkyNest</html>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'console.log("SkyNest")');
  const backend = express();
  backend.get('/', (req, res) => res.json({ status: 'ok' }));
  backend.get('/rooms', (req, res) => res.json({ rooms: [] }));
  backend.get('/api/auth/session', (req, res) => res.status(401).json({ code: 'UNAUTHENTICATED' }));
  backend.post('/api/example', (req, res) => res.status(403).json({ code: 'FORBIDDEN' }));
  const server = createWebApplication(backend, dir).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/rooms', '/dashboard/bookings', '/my-bookings']) {
    const response = await fetch(base + route, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<html>SkyNest</html>');
  }
  const asset = await fetch(base + '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /console.log/);
  for (const route of ['/', '/rooms']) {
    const response = await fetch(base + route, { headers: { Accept: 'application/json' } });
    assert.match(response.headers.get('content-type'), /json/);
  }
  const session = await fetch(base + '/api/auth/session', { headers: { Accept: 'text/html' } });
  assert.equal(session.status, 401);
  assert.deepEqual(await session.json(), { code: 'UNAUTHENTICATED' });
  const write = await fetch(base + '/api/example', { method: 'POST' });
  assert.equal(write.status, 403);
  for (const route of ['/api', '/api/missing', '/assets/missing.js']) {
    const response = await fetch(base + route, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /<html>SkyNest/);
  }
});

test('deployment fails clearly if the frontend was not built', () => {
  assert.throws(() => createWebApplication(express(), path.join(os.tmpdir(), 'skynest-absent-build')), /Frontend build missing/);
});
