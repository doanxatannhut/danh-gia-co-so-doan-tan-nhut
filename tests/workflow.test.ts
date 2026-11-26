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

test('1. 60/40 point structure & unconfigured 40 pts not counted as 0', async () => {
  const adminCookie = await login('admin', 'admin123');
  const dashRes = await request('GET', '/api/dashboard', { cookie: adminCookie });
  assert.equal(dashRes.status, 200);
  const dash = dashRes.json();

  assert.equal(dash.points.fixedMax, 60);
  assert.equal(dash.points.supplementaryConfiguredMax, 0);
  assert.equal(dash.points.supplementaryPublished, false);
  assert.equal(dash.points.activeMaxScore, 60);
  assert.equal(dash.stats.totalUnits, 8);
});

test('2. Strict unit isolation: Cơ sở Đoàn chỉ xem được hồ sơ của đơn vị mình', async () => {
  const adminCookie = await login('admin', 'admin123');
  const unitCookie = await login('cd_th', 'doan123');

  const adminDash = (await request('GET', '/api/dashboard', { cookie: adminCookie })).json();
  const unitDash = (await request('GET', '/api/dashboard', { cookie: unitCookie })).json();

  assert.equal(unitDash.units.length, 1);
  assert.equal(unitDash.units[0].unit_code, 'CD-TH');

  const otherEval = adminDash.units.find((u: { unit_code: string }) => u.unit_code === 'CD-AP1');
  assert.ok(otherEval);

  const forbiddenRes = await request('GET', `/api/evaluations/${otherEval.id}`, { cookie: unitCookie });
  assert.equal(forbiddenRes.status, 403);
});

test('3. Two-round workflow: self-assess -> submit (locks edit) -> mandatory reason on adjust -> return -> resubmit -> confirm', async () => {
  const unitCookie = await login('cd_th', 'doan123');
  const reviewerCookie = await login('thamdinh', 'thamdinh123');

  const unitDash = (await request('GET', '/api/dashboard', { cookie: unitCookie })).json();
  const evalId = unitDash.units[0].id;

  const detail = (await request('GET', `/api/evaluations/${evalId}`, { cookie: unitCookie })).json();
  assert.equal(detail.items.length, 12);

  for (const item of detail.items) {
    const res = await request('PUT', `/api/evaluations/${evalId}/self-score`, {
      cookie: unitCookie,
      body: {
        criterion_id: item.id,
        self_score: item.max_score,
        explanation: `Giải trình hoàn thành ${item.code}`,
      },
    });
    assert.equal(res.status, 200);
  }

  const submitRes = await request('POST', `/api/evaluations/${evalId}/submit`, { cookie: unitCookie });
  assert.equal(submitRes.status, 200);

  // Verify edit is locked after submit
  const lockedRes = await request('PUT', `/api/evaluations/${evalId}/self-score`, {
    cookie: unitCookie,
    body: { criterion_id: detail.items[0].id, self_score: 3, explanation: 'Try edit' },
  });
  assert.equal(lockedRes.status, 409);

  // Round 2: Adjusting score without reason must fail (400)
  const noReasonRes = await request('PUT', `/api/evaluations/${evalId}/review-score`, {
    cookie: reviewerCookie,
    body: {
      criterion_id: detail.items[0].id,
      review_score: detail.items[0].max_score - 1,
      adjustment_reason: '',
      reviewer_comment: 'Cần bổ sung',
    },
  });
  assert.equal(noReasonRes.status, 400);

  // Adjusting score WITH reason must succeed
  const withReasonRes = await request('PUT', `/api/evaluations/${evalId}/review-score`, {
    cookie: reviewerCookie,
    body: {
      criterion_id: detail.items[0].id,
      review_score: detail.items[0].max_score - 1,
      adjustment_reason: 'Thiếu danh sách điểm danh đoàn viên',
      reviewer_comment: 'Đề nghị bổ sung',
      needs_evidence: true,
    },
  });
  assert.equal(withReasonRes.status, 200);

  // Return dossier -> unlocks Round 1 editing
  const returnRes = await request('POST', `/api/evaluations/${evalId}/return`, {
    cookie: reviewerCookie,
    body: { return_note: 'Bổ sung minh chứng TC-1.1' },
  });
  assert.equal(returnRes.status, 200);

  // Unit can now edit and resubmit
  const reEditRes = await request('PUT', `/api/evaluations/${evalId}/self-score`, {
    cookie: unitCookie,
    body: {
      criterion_id: detail.items[0].id,
      self_score: detail.items[0].max_score,
      explanation: 'Đã bổ sung danh sách điểm danh đầy đủ',
    },
  });
  assert.equal(reEditRes.status, 200);

  const resubmitRes = await request('POST', `/api/evaluations/${evalId}/submit`, { cookie: unitCookie });
  assert.equal(resubmitRes.status, 200);

  // Reviewer keeps remaining self scores & confirms official result
  const keepRes = await request('POST', `/api/evaluations/${evalId}/keep-all-self`, { cookie: reviewerCookie });
  assert.equal(keepRes.status, 200);

  const confirmRes = await request('POST', `/api/evaluations/${evalId}/confirm`, {
    cookie: reviewerCookie,
    body: { overall_comment: 'Hoàn thành xuất sắc nhiệm vụ năm 2026' },
  });
  assert.equal(confirmRes.status, 200);
  const confirmJson = confirmRes.json();
  assert.equal(confirmJson.totals.officialTotal, 59);
  assert.equal(confirmJson.totals.classification, 'Hoàn thành xuất sắc');
});

test('4. Immutability guard & Supplementary 40-pt creation/cap validation + Excel/PDF exports', async () => {
  const adminCookie = await login('admin', 'admin123');
  const versionsJson = (await request('GET', '/api/scorecards', { cookie: adminCookie })).json();
  const v2026 = versionsJson.versions.find((v: { year: number }) => v.year === 2026);
  assert.ok(v2026);

  // Cannot add fixed group to active scorecard with active evaluations
  const lockedFixedRes = await request('POST', `/api/scorecards/${v2026.id}/groups`, {
    cookie: adminCookie,
    body: { section_type: 'fixed', code: 'V', title: 'Nhóm thử', max_score: 0 },
  });
  assert.equal(lockedFixedRes.status, 409);

  // CAN add supplementary group while supplementary is unpublished
  const suppGroupRes = await request('POST', `/api/scorecards/${v2026.id}/groups`, {
    cookie: adminCookie,
    body: { section_type: 'supplementary', code: 'BS-I', title: 'Chuyển đổi số thanh niên', max_score: 0 },
  });
  assert.equal(suppGroupRes.status, 201);
  const { group } = suppGroupRes.json();

  // Adding 45 pts to supplementary must fail (> 40 cap)
  const overCapRes = await request('POST', `/api/scorecards/${v2026.id}/items`, {
    cookie: adminCookie,
    body: {
      group_id: group.id,
      code: 'BS-1.1',
      title: 'Tiêu chí vượt trần',
      max_score: 45,
    },
  });
  assert.equal(overCapRes.status, 400);

  // Adding 20 pts to supplementary succeeds
  const validSuppRes = await request('POST', `/api/scorecards/${v2026.id}/items`, {
    cookie: adminCookie,
    body: {
      group_id: group.id,
      code: 'BS-1.1',
      title: 'Mô hình chuyển đổi số cấp Chi đoàn',
      max_score: 20,
    },
  });
  assert.equal(validSuppRes.status, 201);

  // Excel & PDF exports work
  const excelRes = await request('GET', `/api/reports/export/excel?versionId=${v2026.id}`, { cookie: adminCookie });
  assert.equal(excelRes.status, 200);
  assert.ok(String(excelRes.headers['content-type']).includes('spreadsheetml'));
  assert.ok(excelRes.body.length > 1000);

  const pdfRes = await request('GET', `/api/reports/export/pdf?versionId=${v2026.id}`, { cookie: adminCookie });
  assert.equal(pdfRes.status, 200);
  assert.ok(String(pdfRes.headers['content-type']).includes('application/pdf'));
  assert.ok(pdfRes.body.length > 1000);
});
