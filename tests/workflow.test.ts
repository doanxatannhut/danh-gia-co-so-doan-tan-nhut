import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tannhut-eval-test-'));
const socketPath = path.join(tempDir, 'test.sock');
process.env.PGLITE_DATA_DIR = path.join(tempDir, 'pgdata');

const { createApp } = await import('../server/index.js');
const { getDb } = await import('../server/db/client.js');

let server: Server;

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  json: <T = any>() => T;
}

function request(
  method: string,
  reqPath: string,
  options: { cookie?: string; body?: unknown } = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request({ socketPath, path: reqPath, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: buf,
          json: () => JSON.parse(buf.toString('utf8')),
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(username: string, password: string): Promise<string> {
  const res = await request('POST', '/api/auth/login', { body: { username, password } });
  assert.equal(res.status, 200, `Login failed for ${username}`);
  const cookies = res.headers['set-cookie'];
  assert.ok(cookies && cookies.length > 0, 'Expected session cookie');
  return cookies[0].split(';')[0];
}

test.before(async () => {
  const app = await createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(socketPath, () => resolve());
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const db = await getDb();
  await db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('1. Clean initial state: only admin account, 0 mock units, 60/40 scorecard ready', async () => {
  const adminCookie = await login('admin', 'admin123');
  const usersRes = await request('GET', '/api/admin/users', { cookie: adminCookie });
  assert.equal(usersRes.status, 200);
  assert.equal(usersRes.json().users.length, 1);
  assert.equal(usersRes.json().users[0].username, 'admin');

  const dashRes = await request('GET', '/api/dashboard', { cookie: adminCookie });
  assert.equal(dashRes.status, 200);
  const dash = dashRes.json();
  assert.equal(dash.stats.totalUnits, 0);
  assert.equal(dash.points.fixedMax, 60);
  assert.equal(dash.points.supplementaryConfiguredMax, 0);
  assert.equal(dash.points.activeMaxScore, 60);
});

test('2. Admin creates Cơ sở Đoàn & accounts (Cán bộ Đoàn xã + Cơ sở Đoàn) + strict isolation', async () => {
  const adminCookie = await login('admin', 'admin123');

  const u1 = await request('POST', '/api/admin/units', {
    cookie: adminCookie,
    body: { code: 'CD-TEST1', name: 'Chi đoàn Ấp 1', secretary_name: 'Nguyễn A', member_count: 30 },
  });
  assert.equal(u1.status, 201);
  const unit1Id = u1.json().unit.id;

  const u2 = await request('POST', '/api/admin/units', {
    cookie: adminCookie,
    body: { code: 'CD-TEST2', name: 'Chi đoàn Ấp 2', secretary_name: 'Trần B', member_count: 25 },
  });
  assert.equal(u2.status, 201);

  const reviewerRes = await request('POST', '/api/admin/users', {
    cookie: adminCookie,
    body: { username: 'canbo_xa', password: 'password123', full_name: 'Cán bộ Đoàn xã 1', role: 'reviewer', title: 'Phó Bí thư Đoàn xã' },
  });
  assert.equal(reviewerRes.status, 201);

  const unitUserRes = await request('POST', '/api/admin/users', {
    cookie: adminCookie,
    body: { username: 'chidoan1', password: 'password123', full_name: 'Nguyễn A', role: 'unit', unit_id: unit1Id, title: 'Bí thư Chi đoàn' },
  });
  assert.equal(unitUserRes.status, 201);

  const unitCookie = await login('chidoan1', 'password123');
  const adminDash = (await request('GET', '/api/dashboard', { cookie: adminCookie })).json();
  const unitDash = (await request('GET', '/api/dashboard', { cookie: unitCookie })).json();

  assert.equal(adminDash.units.length, 2);
  assert.equal(unitDash.units.length, 1);
  assert.equal(unitDash.units[0].unit_code, 'CD-TEST1');

  const otherEval = adminDash.units.find((u: { unit_code: string }) => u.unit_code === 'CD-TEST2');
  const forbiddenRes = await request('GET', `/api/evaluations/${otherEval.id}`, { cookie: unitCookie });
  assert.equal(forbiddenRes.status, 403);
});

test('3. Two-round workflow with newly created Cơ sở Đoàn & Cán bộ Đoàn xã', async () => {
  const unitCookie = await login('chidoan1', 'password123');
  const reviewerCookie = await login('canbo_xa', 'password123');

  const unitDash = (await request('GET', '/api/dashboard', { cookie: unitCookie })).json();
  const evalId = unitDash.units[0].id;

  const detail = (await request('GET', `/api/evaluations/${evalId}`, { cookie: unitCookie })).json();
  assert.equal(detail.items.length, 12);

  for (const item of detail.items) {
    const res = await request('PUT', `/api/evaluations/${evalId}/self-score`, {
      cookie: unitCookie,
      body: { criterion_id: item.id, self_score: item.max_score, explanation: `Giải trình ${item.code}` },
    });
    assert.equal(res.status, 200);
  }

  assert.equal((await request('POST', `/api/evaluations/${evalId}/submit`, { cookie: unitCookie })).status, 200);

  // Locked after submit
  const lockedRes = await request('PUT', `/api/evaluations/${evalId}/self-score`, {
    cookie: unitCookie,
    body: { criterion_id: detail.items[0].id, self_score: 3, explanation: 'Try edit' },
  });
  assert.equal(lockedRes.status, 409);

  // Mandatory reason when adjusting score
  const noReasonRes = await request('PUT', `/api/evaluations/${evalId}/review-score`, {
    cookie: reviewerCookie,
    body: { criterion_id: detail.items[0].id, review_score: detail.items[0].max_score - 1, adjustment_reason: '' },
  });
  assert.equal(noReasonRes.status, 400);

  const withReasonRes = await request('PUT', `/api/evaluations/${evalId}/review-score`, {
    cookie: reviewerCookie,
    body: {
      criterion_id: detail.items[0].id,
      review_score: detail.items[0].max_score - 1,
      adjustment_reason: 'Thiếu danh sách điểm danh',
      reviewer_comment: 'Cần bổ sung',
    },
  });
  assert.equal(withReasonRes.status, 200);

  assert.equal((await request('POST', `/api/evaluations/${evalId}/keep-all-self`, { cookie: reviewerCookie })).status, 200);

  const confirmRes = await request('POST', `/api/evaluations/${evalId}/confirm`, {
    cookie: reviewerCookie,
    body: { overall_comment: 'Hoàn thành xuất sắc' },
  });
  assert.equal(confirmRes.status, 200);
  assert.equal(confirmRes.json().totals.officialTotal, 59);
  assert.equal(confirmRes.json().totals.classification, 'Hoàn thành xuất sắc');
});

test('4. Immutability guard, 40-pt supplementary cap & Excel/PDF exports', async () => {
  const adminCookie = await login('admin', 'admin123');
  const versionsJson = (await request('GET', '/api/scorecards', { cookie: adminCookie })).json();
  const v2026 = versionsJson.versions[0];

  // Fixed criteria locked because active evaluation exists
  const lockedFixedRes = await request('POST', `/api/scorecards/${v2026.id}/groups`, {
    cookie: adminCookie,
    body: { section_type: 'fixed', code: 'V', title: 'Nhóm thử', max_score: 0 },
  });
  assert.equal(lockedFixedRes.status, 409);

  // Supplementary still open while unpublished
  const suppGroupRes = await request('POST', `/api/scorecards/${v2026.id}/groups`, {
    cookie: adminCookie,
    body: { section_type: 'supplementary', code: 'BS-I', title: 'Chuyển đổi số', max_score: 0 },
  });
  assert.equal(suppGroupRes.status, 201);
  const { group } = suppGroupRes.json();

  const overCapRes = await request('POST', `/api/scorecards/${v2026.id}/items`, {
    cookie: adminCookie,
    body: { group_id: group.id, code: 'BS-1.1', title: 'Vượt trần', max_score: 45 },
  });
  assert.equal(overCapRes.status, 400);

  const excelRes = await request('GET', `/api/reports/export/excel?versionId=${v2026.id}`, { cookie: adminCookie });
  assert.equal(excelRes.status, 200);
  assert.ok(String(excelRes.headers['content-type']).includes('spreadsheetml'));

  const pdfRes = await request('GET', `/api/reports/export/pdf?versionId=${v2026.id}`, { cookie: adminCookie });
  assert.equal(pdfRes.status, 200);
  assert.ok(String(pdfRes.headers['content-type']).includes('application/pdf'));
});
