import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Server } from 'node:http';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tannhut-attendance-test-'));
const socketPath = path.join(tempDir, 'att.sock');
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

async function loginAdmin(): Promise<string> {
  const res = await request('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  assert.equal(res.status, 200);
  return res.headers['set-cookie']![0].split(';')[0];
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

test('Dynamic QR Attendance: all 12 acceptance criteria (valid, expired, wrong session, GPS, anti-duplicate, concurrency, shared device, closed, Excel)', async () => {
  const adminCookie = await loginAdmin();

  // Create Session 1 (UBND xã Tân Nhựt: 10.7155, 106.5642, radius 80m)
  const s1Res = await request('POST', '/api/attendance/sessions', {
    cookie: adminCookie,
    body: {
      title: 'Ngày Chủ nhật xanh xã Tân Nhựt',
      description: 'Ra quân dọn vệ sinh tuyến đường trung tâm',
      event_date: '2026-11-28',
      start_time: '07:30',
      end_time: '11:00',
      location_name: 'UBND xã Tân Nhựt',
      latitude: 10.7155,
      longitude: 106.5642,
      radius_meters: 80,
      qr_refresh_seconds: 20,
      require_photo: false,
      expected_count: 40,
    },
  });
  assert.equal(s1Res.status, 201);
  const s1Id = s1Res.json().session.id;

  // Create Session 2 (for cross-session QR test)
  const s2Res = await request('POST', '/api/attendance/sessions', {
    cookie: adminCookie,
    body: {
      title: 'Tập huấn cán bộ Đoàn',
      event_date: '2026-11-28',
      start_time: '13:30',
      end_time: '17:00',
      location_name: 'UBND xã Tân Nhựt',
      latitude: 10.7155,
      longitude: 106.5642,
      radius_meters: 80,
      qr_refresh_seconds: 20,
    },
  });
  assert.equal(s2Res.status, 201);
  const s2Id = s2Res.json().session.id;

  // Open both sessions
  assert.equal((await request('PATCH', `/api/attendance/sessions/${s1Id}/status`, { cookie: adminCookie, body: { status: 'active' } })).status, 200);
  assert.equal((await request('PATCH', `/api/attendance/sessions/${s2Id}/status`, { cookie: adminCookie, body: { status: 'active' } })).status, 200);

  // Get live dynamic QR for Session 1 & Session 2
  const qr1 = (await request('GET', `/api/attendance/sessions/${s1Id}/qr`, { cookie: adminCookie })).json();
  const qr2 = (await request('GET', `/api/attendance/sessions/${s2Id}/qr`, { cookie: adminCookie })).json();
  assert.ok(qr1.token && qr1.qrDataUrl.startsWith('data:image/png;base64,'));

  // Fetch official units list for public dropdown
  const unitsJson = (await request('GET', '/api/public/attendance/units')).json();
  assert.equal(unitsJson.units.length, 55);
  const sampleUnitId = unitsJson.units[0].id;

  // Missing name or unit must be rejected (400)
  const missingInfo = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7156,
      longitude: 106.5642,
      accuracy: 12,
      client_device_token: 'device-missing-info',
    },
  });
  assert.equal(missingInfo.status, 400);
  assert.equal(missingInfo.json().code, 'PARTICIPANT_INFO_REQUIRED');

  // 1. Valid QR + Valid GPS inside 80m + Name & Chi đoàn -> Check-in succeeds (NO login required!)
  const validCheckin = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7156, // ~11m away
      longitude: 106.5642,
      accuracy: 12,
      participant_name: 'Nguyễn Văn A',
      unit_id: sampleUnitId,
      client_device_token: 'device-alpha',
    },
  });
  assert.equal(validCheckin.status, 201);
  assert.equal(validCheckin.json().message, 'ĐIỂM DANH THÀNH CÔNG');
  assert.equal(validCheckin.json().record.participant_name, 'Nguyễn Văn A');
  const devAlphaCookie = validCheckin.headers['set-cookie']![0].split(';')[0];

  // 6 & 7. Re-scanning QR / reloading page with same device -> does NOT create a duplicate record
  const duplicateRes = await request('POST', '/api/public/attendance/checkin', {
    cookie: devAlphaCookie,
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7156,
      longitude: 106.5642,
      accuracy: 12,
      participant_name: 'Nguyễn Văn A',
      unit_id: sampleUnitId,
      client_device_token: 'device-alpha',
    },
  });
  assert.equal(duplicateRes.status, 200);
  assert.equal(duplicateRes.json().alreadyCheckedIn, true);

  // 11. Second attempt on same device (even with shared_device: true) -> strictly blocked from creating new record, returns alreadyCheckedIn
  const sharedRes = await request('POST', '/api/public/attendance/checkin', {
    cookie: devAlphaCookie,
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7156,
      longitude: 106.5642,
      accuracy: 12,
      participant_name: 'Trần Thị B',
      unit_id: sampleUnitId,
      client_device_token: 'device-alpha',
      shared_device: true,
    },
  });
  assert.equal(sharedRes.status, 200);
  assert.equal(sharedRes.json().alreadyCheckedIn, true);

  // 3. Wrong-session QR (qr2 used on s1) -> rejected
  const wrongSessionRes = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr2.token,
      latitude: 10.7156,
      longitude: 106.5642,
      accuracy: 10,
      participant_name: 'Lê Văn C',
      unit_id: sampleUnitId,
      client_device_token: 'device-beta',
    },
  });
  assert.equal(wrongSessionRes.status, 400);
  assert.equal(wrongSessionRes.json().code, 'QR_WRONG_SESSION');

  // 4 & 8. Out-of-range GPS (screenshot QR sent to someone ~2km away) -> rejected with exact message
  const farRes = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7350, // >2km away
      longitude: 106.5642,
      accuracy: 15,
      participant_name: 'Phạm Văn D',
      unit_id: sampleUnitId,
      client_device_token: 'device-far',
    },
  });
  assert.equal(farRes.status, 400);
  assert.equal(farRes.json().code, 'GPS_OUT_OF_RANGE');
  assert.equal(farRes.json().error, 'Bạn đang ở ngoài khu vực tổ chức. Vui lòng đến địa điểm để điểm danh.');

  // 5. No GPS / denied permission -> rejected with exact message, no record created
  const noGpsRes = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      participant_name: 'Võ Thị E',
      unit_id: sampleUnitId,
      client_device_token: 'device-nogps',
    },
  });
  assert.equal(noGpsRes.status, 400);
  assert.equal(noGpsRes.json().code, 'GPS_UNAVAILABLE');
  assert.equal(noGpsRes.json().error, 'Không thể xác định vị trí. Vui lòng bật định vị và thử lại.');

  // 9. Concurrent check-in burst (5 simultaneous requests from same device) -> only 1 row created!
  const verifyInit = await request('POST', '/api/public/attendance/verify-gps', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7155,
      longitude: 106.5643,
      accuracy: 10,
      client_device_token: 'device-concurrent',
    },
  });
  assert.equal(verifyInit.status, 200);
  assert.equal(verifyInit.json().message, 'Đã xác nhận vị trí, vui lòng hoàn tất điểm danh.');
  const concCookie = verifyInit.headers['set-cookie']![0].split(';')[0];

  await Promise.all(
    Array.from({ length: 5 }, () =>
      request('POST', '/api/public/attendance/checkin', {
        cookie: concCookie,
        body: {
          session_id: s1Id,
          token: qr1.token,
          latitude: 10.7155,
          longitude: 106.5643,
          accuracy: 10,
          participant_name: 'Hoàng Văn F',
          unit_id: sampleUnitId,
          client_device_token: 'device-concurrent',
        },
      }),
    ),
  );

  // 2. Expired / rotated QR -> rejected
  assert.equal((await request('POST', `/api/attendance/sessions/${s1Id}/refresh-qr`, { cookie: adminCookie })).status, 200);
  const expiredQrRes = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7155,
      longitude: 106.5642,
      accuracy: 10,
      participant_name: 'Đặng Văn G',
      unit_id: sampleUnitId,
      client_device_token: 'device-expired',
    },
  });
  assert.equal(expiredQrRes.status, 400);
  assert.equal(expiredQrRes.json().code, 'QR_EXPIRED');

  // Verify dashboard stats: exactly 2 valid (alpha + concurrent), 0 pending -> 2 records total
  const dash = (await request('GET', `/api/attendance/sessions/${s1Id}/dashboard`, { cookie: adminCookie })).json();
  assert.equal(dash.stats.validCount, 2);
  assert.equal(dash.stats.pendingCount, 0);
  assert.equal(dash.records.length, 2);
  assert.ok(dash.stats.rejectedCount >= 4);

  // Excel export works
  const excelRes = await request('GET', `/api/attendance/sessions/${s1Id}/export/excel`, { cookie: adminCookie });
  assert.equal(excelRes.status, 200);
  assert.ok(String(excelRes.headers['content-type']).includes('spreadsheetml'));

  // 10. Closed session -> rejected
  assert.equal((await request('PATCH', `/api/attendance/sessions/${s1Id}/status`, { cookie: adminCookie, body: { status: 'closed' } })).status, 200);
  const closedRes = await request('POST', '/api/public/attendance/checkin', {
    body: {
      session_id: s1Id,
      token: qr1.token,
      latitude: 10.7155,
      longitude: 106.5642,
      accuracy: 10,
      client_device_token: 'device-after-close',
    },
  });
  assert.equal(closedRes.status, 409);
  assert.equal(closedRes.json().code, 'SESSION_CLOSED');
});
