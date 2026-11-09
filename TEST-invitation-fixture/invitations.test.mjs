import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createInvitationFixture } from './invitations.mjs';

async function withFixture(run) {
  const server = createInvitationFixture();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
const headers = { authorization: 'Bearer TEST-admin-session' };
const dashboard = '/TEST/dashboard';
const adminInvite = '/TEST/admin/invitations/TEST-invite';
const recipient = '/TEST/invitations/TEST-recipient-token';

test('admin dashboard lists pending invite; revoke removes it and invalidates recipient access', () => withFixture(async request => {
  const before = await request(dashboard, { headers });
  assert.equal(before.status, 200);
  const html = await before.text();
  assert.match(html, /TEST-invite/);
  assert.match(html, /Revoke invitation/);
  assert.match(html, /method: 'DELETE'/);
  assert.equal((await request(recipient)).status, 200);
  assert.equal((await request(adminInvite, { method: 'DELETE', headers })).status, 204);
  assert.doesNotMatch(await (await request(dashboard, { headers })).text(), /data-id="TEST-invite"/);
  assert.equal((await request(recipient)).status, 404);
  assert.equal((await request(recipient)).status, 404);
  assert.equal((await request(adminInvite, { method: 'DELETE', headers })).status, 404);
}));

test('unauthorized dashboard and revocation cannot expose or change the invitation', () => withFixture(async request => {
  for (const authorization of [undefined, 'Bearer TEST-recipient-token', 'Bearer wrong']) {
    const credentials = authorization ? { authorization } : {};
    assert.equal((await request(dashboard, { headers: credentials })).status, 403);
    assert.equal((await request(adminInvite, { method: 'DELETE', headers: credentials })).status, 403);
    assert.equal((await request(recipient)).status, 200);
  }
}));

test('unknown invites, wrong methods, and product paths have no effect', () => withFixture(async request => {
  assert.equal((await request('/TEST/invitations/unknown')).status, 404);
  assert.equal((await request('/TEST/admin/invitations/unknown', { method: 'DELETE', headers })).status, 404);
  assert.equal((await request(adminInvite, { method: 'POST', headers })).status, 404);
  assert.equal((await request('/dashboard', { headers })).status, 404);
  assert.equal((await request(recipient)).status, 200);
}));
