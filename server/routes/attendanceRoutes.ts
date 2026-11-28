import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import ExcelJS from 'exceljs';
import { getDb } from '../db/client.js';
import { requireAuth, requireRoles, writeAuditLog } from '../auth.js';

export const attendanceRouter = Router();

const PHOTO_DIR = path.resolve(process.cwd(), 'data', 'attendance-photos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const DEVICE_COOKIE = 'tttn_dev_id';
const HMAC_SECRET = process.env.SESSION_SECRET || 'tuoi-tre-tan-nhut-qr-hmac-secret-dev';

// Simple per-IP rate limiter for public check-in endpoints
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string, maxPerMin = 40): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= maxPerMin) return false;
  bucket.count += 1;
  return true;
}

// Haversine distance in meters
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

interface QrPayload {
  sid: number;
  v: number;
  iat: number;
  exp: number;
  n: string;
}

function signPayload(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedPayload<T>(token: string): T | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function createDynamicQrToken(sessionId: number, secretVersion: number, refreshSeconds: number) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + refreshSeconds;
  const payload: QrPayload = {
    sid: sessionId,
    v: secretVersion,
    iat: nowSec,
    exp: expSec,
    n: crypto.randomBytes(6).toString('hex'),
  };
  return {
    token: signPayload(payload),
    issuedAt: new Date(nowSec * 1000).toISOString(),
    expiresAt: new Date(expSec * 1000).toISOString(),
    remainingSeconds: refreshSeconds,
  };
}

function validateQrToken(
  token: string,
  expectedSessionId: number,
  currentSecretVersion: number,
): { ok: true; payload: QrPayload; hash: string } | { ok: false; code: string; message: string; qrStatus: 'expired' | 'invalid' } {
  const payload = verifySignedPayload<QrPayload>(token);
  if (!payload || typeof payload.sid !== 'number' || typeof payload.exp !== 'number') {
    return {
      ok: false,
      code: 'QR_INVALID',
      message: 'Mã QR không hợp lệ hoặc bị giả mạo. Vui lòng quét lại mã QR trực tiếp tại màn hình.',
      qrStatus: 'invalid',
    };
  }
  if (payload.sid !== expectedSessionId) {
    return {
      ok: false,
      code: 'QR_WRONG_SESSION',
      message: 'Mã QR không thuộc phiên hoạt động này. Vui lòng quét đúng mã QR của hoạt động đang diễn ra.',
      qrStatus: 'invalid',
    };
  }
  if (payload.v !== currentSecretVersion) {
    return {
      ok: false,
      code: 'QR_EXPIRED',
      message: 'Mã QR đã được làm mới và hết hiệu lực. Vui lòng quét lại mã QR mới nhất trên màn hình.',
      qrStatus: 'expired',
    };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > payload.exp) {
    return {
      ok: false,
      code: 'QR_EXPIRED',
      message: 'Mã QR đã hết hạn. Vui lòng quét mã QR mới đang hiển thị tại địa điểm tổ chức.',
      qrStatus: 'expired',
    };
  }
  const hash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 24);
  return { ok: true, payload, hash };
}

function getOrIssueDeviceFingerprint(req: Request, res: Response, clientToken?: string): string {
  let rawId = req.cookies?.[DEVICE_COOKIE];
  if (!rawId) {
    rawId = crypto.randomBytes(16).toString('hex');
    res.cookie(DEVICE_COOKIE, rawId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
  }
  const basis = clientToken ? `${rawId}:${clientToken.slice(0, 64)}` : rawId;
  return crypto.createHmac('sha256', HMAC_SECRET).update(basis).digest('hex').slice(0, 24);
}

function summarizeUserAgent(ua: string): string {
  const s = ua || '';
  const os = /iPhone|iPad/i.test(s)
    ? 'iOS'
    : /Android/i.test(s)
      ? 'Android'
      : /Mac OS/i.test(s)
        ? 'macOS'
        : /Windows/i.test(s)
          ? 'Windows'
          : 'Thiết bị khác';
  const browser = /Edg/i.test(s)
    ? 'Edge'
    : /Chrome|CriOS/i.test(s)
      ? 'Chrome'
      : /Safari/i.test(s)
        ? 'Safari'
        : /Firefox/i.test(s)
          ? 'Firefox'
          : 'Trình duyệt';
  return `${os} · ${browser}`;
}

function generateConfirmationCode(): string {
  return `TTTN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

interface SessionRow {
  id: number;
  code: string;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location_name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  qr_refresh_seconds: number;
  require_photo: boolean;
  expected_count: number;
  status: 'not_open' | 'active' | 'paused' | 'closed';
  qr_secret_version: number;
  photo_retention_days: number;
  created_at: string;
  updated_at: string;
}

function validateGpsInput(
  latRaw: unknown,
  lonRaw: unknown,
  accRaw: unknown,
  session: SessionRow,
):
  | { ok: true; lat: number; lon: number; accuracy: number | null; distance: number; suspicious: boolean }
  | { ok: false; code: string; message: string; gpsStatus: 'out_of_range' | 'unavailable' | 'suspicious'; distance?: number; accuracy?: number | null } {
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const accuracy = accRaw !== null && accRaw !== undefined && accRaw !== '' ? Number(accRaw) : null;

  if (
    latRaw === null ||
    latRaw === undefined ||
    lonRaw === null ||
    lonRaw === undefined ||
    Number.isNaN(lat) ||
    Number.isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180 ||
    (lat === 0 && lon === 0)
  ) {
    return {
      ok: false,
      code: 'GPS_UNAVAILABLE',
      message: 'Không thể xác định vị trí. Vui lòng bật định vị và thử lại.',
      gpsStatus: 'unavailable',
      accuracy,
    };
  }

  // Extremely low GPS precision (> 500m) is unreliable for 50-100m geofence
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 500)) {
    return {
      ok: false,
      code: 'GPS_UNAVAILABLE',
      message: 'Không thể xác định vị trí. Vui lòng bật định vị và thử lại.',
      gpsStatus: 'unavailable',
      accuracy,
    };
  }

  const distance = haversineMeters(session.latitude, session.longitude, lat, lon);
  if (distance > session.radius_meters) {
    return {
      ok: false,
      code: 'GPS_OUT_OF_RANGE',
      message: 'Bạn đang ở ngoài khu vực tổ chức. Vui lòng đến địa điểm để điểm danh.',
      gpsStatus: 'out_of_range',
      distance,
      accuracy,
    };
  }

  // Flag mild suspicious indicator (e.g. mocked exact 0.0m with unrealistic accuracy) without auto-accusing
  const suspicious = accuracy !== null && accuracy < 1;
  return { ok: true, lat, lon, accuracy, distance, suspicious };
}

async function logAttempt(params: {
  sessionId: number | null;
  outcome: 'valid' | 'pending_verification' | 'rejected';
  rejectCode?: string;
  rejectReason?: string;
  deviceFp?: string;
  deviceSummary?: string;
  distance?: number | null;
  accuracy?: number | null;
  gpsStatus?: string;
  qrStatus?: string;
}) {
  const db = await getDb();
  await db.query(
    `INSERT INTO attendance_attempts
      (session_id, outcome, reject_code, reject_reason, device_fingerprint, device_summary, distance_meters, gps_accuracy, gps_status, qr_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      params.sessionId,
      params.outcome,
      params.rejectCode ?? '',
      params.rejectReason ?? '',
      params.deviceFp ?? '',
      params.deviceSummary ?? '',
      params.distance ?? null,
      params.accuracy ?? null,
      params.gpsStatus ?? '',
      params.qrStatus ?? '',
    ],
  );
}

// ============================================================================
// PUBLIC ENDPOINTS (NO LOGIN, NO MÃ ĐOÀN VIÊN REQUIRED)
// ============================================================================

// Public list of active Cơ sở Đoàn for mobile check-in dropdown
attendanceRouter.get('/public/attendance/units', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, code, name, unit_type FROM units WHERE active = TRUE ORDER BY code ASC, id ASC`,
    );
    res.json({ units: result.rows });
  } catch (err) {
    console.error('Public attendance units error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách Chi đoàn.' });
  }
});

// Screen 1: List active sessions
attendanceRouter.get('/public/attendance/active', async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT id, code, title, description, event_date, start_time, end_time,
              location_name, radius_meters, require_photo, status
       FROM attendance_sessions
       WHERE status = 'active'
       ORDER BY event_date DESC, start_time ASC, id DESC`,
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('Public active sessions error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách hoạt động đang mở.' });
  }
});

// Inspect scanned QR session info before GPS step
attendanceRouter.get('/public/attendance/session-info', async (req, res) => {
  try {
    const sessionId = Number(req.query.s);
    const token = String(req.query.t ?? '');
    if (!sessionId) {
      res.status(400).json({ error: 'Thiếu mã phiên điểm danh.' });
      return;
    }

    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [sessionId]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }

    let qrCheck: { valid: boolean; code?: string; message?: string } = { valid: false, code: 'QR_MISSING', message: 'Chưa có mã QR hợp lệ.' };
    if (token) {
      const v = validateQrToken(token, session.id, session.qr_secret_version);
      qrCheck = v.ok ? { valid: true } : { valid: false, code: v.code, message: v.message };
    }

    res.json({
      session: {
        id: session.id,
        code: session.code,
        title: session.title,
        description: session.description,
        event_date: session.event_date,
        start_time: session.start_time,
        end_time: session.end_time,
        location_name: session.location_name,
        radius_meters: session.radius_meters,
        require_photo: session.require_photo,
        status: session.status,
      },
      qrCheck,
    });
  } catch (err) {
    console.error('Session info error:', err);
    res.status(500).json({ error: 'Không thể kiểm tra thông tin phiên điểm danh.' });
  }
});

// Screen 2: Verify QR + GPS on server & issue short-lived check-in ticket
attendanceRouter.post('/public/attendance/verify-gps', async (req, res) => {
  try {
    if (!checkRateLimit(req.ip || 'unknown')) {
      res.status(429).json({ error: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít giây.', code: 'RATE_LIMITED' });
      return;
    }

    const sessionId = Number(req.body?.session_id);
    const token = String(req.body?.token ?? '');
    const clientDeviceToken = String(req.body?.client_device_token ?? '');
    const deviceSummary = summarizeUserAgent(req.headers['user-agent'] || '');
    const deviceFp = getOrIssueDeviceFingerprint(req, res, clientDeviceToken);

    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [sessionId]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Phiên điểm danh không tồn tại.', code: 'SESSION_NOT_FOUND' });
      return;
    }

    if (session.status !== 'active') {
      const msg =
        session.status === 'closed'
          ? 'Phiên điểm danh đã kết thúc. Không thể tiếp tục điểm danh.'
          : session.status === 'paused'
            ? 'Phiên điểm danh đang tạm dừng. Vui lòng chờ cán bộ phụ trách mở lại.'
            : 'Phiên điểm danh chưa được mở.';
      await logAttempt({
        sessionId: session.id,
        outcome: 'rejected',
        rejectCode: session.status === 'closed' ? 'SESSION_CLOSED' : 'SESSION_NOT_ACTIVE',
        rejectReason: msg,
        deviceFp,
        deviceSummary,
      });
      res.status(409).json({ error: msg, code: session.status === 'closed' ? 'SESSION_CLOSED' : 'SESSION_NOT_ACTIVE' });
      return;
    }

    const qrRes = validateQrToken(token, session.id, session.qr_secret_version);
    if (!qrRes.ok) {
      await logAttempt({
        sessionId: session.id,
        outcome: 'rejected',
        rejectCode: qrRes.code,
        rejectReason: qrRes.message,
        deviceFp,
        deviceSummary,
        qrStatus: qrRes.qrStatus,
      });
      res.status(400).json({ error: qrRes.message, code: qrRes.code });
      return;
    }

    const gpsRes = validateGpsInput(req.body?.latitude, req.body?.longitude, req.body?.accuracy, session);
    if (!gpsRes.ok) {
      await logAttempt({
        sessionId: session.id,
        outcome: 'rejected',
        rejectCode: gpsRes.code,
        rejectReason: gpsRes.message,
        deviceFp,
        deviceSummary,
        distance: gpsRes.distance ?? null,
        accuracy: gpsRes.accuracy ?? null,
        gpsStatus: gpsRes.gpsStatus,
        qrStatus: 'valid',
      });
      res.status(400).json({
        error: gpsRes.message,
        code: gpsRes.code,
        distanceMeters: gpsRes.distance ?? null,
        radiusMeters: session.radius_meters,
      });
      return;
    }

    // Check if this device already checked in for this session
    const existingRes = await db.query<{
      confirmation_code: string;
      checked_in_at: string;
      status: string;
      participant_name: string;
      unit_name: string;
    }>(
      `SELECT confirmation_code, checked_in_at, status, participant_name, unit_name FROM attendance_records
       WHERE session_id = $1 AND device_fingerprint = $2 AND status IN ('valid', 'pending_verification')
       ORDER BY checked_in_at ASC LIMIT 1`,
      [session.id, deviceFp],
    );

    // Issue short-lived server-signed verification ticket (90s) for completing photo/check-in
    const nowSec = Math.floor(Date.now() / 1000);
    const verifyTicket = signPayload({
      kind: 'gps_ticket',
      sid: session.id,
      v: session.qr_secret_version,
      fp: deviceFp,
      qrHash: qrRes.hash,
      lat: gpsRes.lat,
      lon: gpsRes.lon,
      acc: gpsRes.accuracy,
      dist: gpsRes.distance,
      exp: nowSec + 90,
    });

    res.json({
      ok: true,
      message: 'Đã xác nhận vị trí, vui lòng hoàn tất điểm danh.',
      distanceMeters: gpsRes.distance,
      radiusMeters: session.radius_meters,
      requirePhoto: session.require_photo,
      verifyTicket,
      existingCheckin: existingRes.rows[0] ?? null,
    });
  } catch (err) {
    console.error('Verify GPS error:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi xác thực vị trí.' });
  }
});

interface GpsTicketPayload {
  kind: 'gps_ticket';
  sid: number;
  v: number;
  fp: string;
  qrHash: string;
  lat: number;
  lon: number;
  acc: number | null;
  dist: number;
  exp: number;
}

// Screen 3: Complete check-in (atomic, anti-duplicate, supports live photo & shared device verification)
attendanceRouter.post('/public/attendance/checkin', async (req, res) => {
  try {
    if (!checkRateLimit(req.ip || 'unknown')) {
      res.status(429).json({ error: 'Quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau.', code: 'RATE_LIMITED' });
      return;
    }

    const sessionId = Number(req.body?.session_id);
    const token = String(req.body?.token ?? '');
    const verifyTicket = String(req.body?.verify_ticket ?? '');
    const clientDeviceToken = String(req.body?.client_device_token ?? '');
    const sharedDevice = Boolean(req.body?.shared_device ?? false);
    const participantName = String(req.body?.participant_name ?? '').trim().slice(0, 120);
    const unitIdRaw = req.body?.unit_id ? Number(req.body.unit_id) : null;
    const participantNote = String(req.body?.participant_note ?? '').trim().slice(0, 200);
    const photoBase64 = typeof req.body?.photo_data_url === 'string' ? req.body.photo_data_url : '';
    const deviceSummary = summarizeUserAgent(req.headers['user-agent'] || '');
    const deviceFp = getOrIssueDeviceFingerprint(req, res, clientDeviceToken);

    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [sessionId]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Phiên điểm danh không tồn tại.', code: 'SESSION_NOT_FOUND' });
      return;
    }

    if (session.status !== 'active') {
      const msg =
        session.status === 'closed'
          ? 'Phiên điểm danh đã kết thúc. Không cho phép điểm danh.'
          : session.status === 'paused'
            ? 'Phiên điểm danh đang tạm dừng.'
            : 'Phiên điểm danh chưa mở.';
      await logAttempt({
        sessionId: session.id,
        outcome: 'rejected',
        rejectCode: session.status === 'closed' ? 'SESSION_CLOSED' : 'SESSION_NOT_ACTIVE',
        rejectReason: msg,
        deviceFp,
        deviceSummary,
      });
      res.status(409).json({ error: msg, code: session.status === 'closed' ? 'SESSION_CLOSED' : 'SESSION_NOT_ACTIVE' });
      return;
    }

    if (!participantName || !unitIdRaw || Number.isNaN(unitIdRaw)) {
      res.status(400).json({
        error: 'Vui lòng nhập đầy đủ Họ và tên và chọn Chi đoàn / Cơ sở Đoàn trước khi điểm danh.',
        code: 'PARTICIPANT_INFO_REQUIRED',
      });
      return;
    }

    const unitRes = await db.query<{ id: number; name: string }>(
      'SELECT id, name FROM units WHERE id = $1 AND active = TRUE',
      [unitIdRaw],
    );
    const unitRow = unitRes.rows[0];
    if (!unitRow) {
      res.status(400).json({
        error: 'Chi đoàn / Cơ sở Đoàn được chọn không hợp lệ.',
        code: 'INVALID_UNIT',
      });
      return;
    }

    // Validate either signed GPS ticket (issued seconds ago after live QR+GPS check) OR fresh QR + GPS directly
    let qrHash = '';
    let lat: number;
    let lon: number;
    let accuracy: number | null;
    let distance: number;
    let gpsStatus: 'valid' | 'suspicious' = 'valid';

    const parsedTicket = verifyTicket ? verifySignedPayload<GpsTicketPayload>(verifyTicket) : null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      parsedTicket &&
      parsedTicket.kind === 'gps_ticket' &&
      parsedTicket.sid === session.id &&
      parsedTicket.v === session.qr_secret_version &&
      parsedTicket.fp === deviceFp &&
      nowSec <= parsedTicket.exp
    ) {
      qrHash = parsedTicket.qrHash;
      lat = parsedTicket.lat;
      lon = parsedTicket.lon;
      accuracy = parsedTicket.acc;
      distance = parsedTicket.dist;
    } else {
      const qrRes = validateQrToken(token, session.id, session.qr_secret_version);
      if (!qrRes.ok) {
        await logAttempt({
          sessionId: session.id,
          outcome: 'rejected',
          rejectCode: qrRes.code,
          rejectReason: qrRes.message,
          deviceFp,
          deviceSummary,
          qrStatus: qrRes.qrStatus,
        });
        res.status(400).json({ error: qrRes.message, code: qrRes.code });
        return;
      }

      const gpsRes = validateGpsInput(req.body?.latitude, req.body?.longitude, req.body?.accuracy, session);
      if (!gpsRes.ok) {
        await logAttempt({
          sessionId: session.id,
          outcome: 'rejected',
          rejectCode: gpsRes.code,
          rejectReason: gpsRes.message,
          deviceFp,
          deviceSummary,
          distance: gpsRes.distance ?? null,
          accuracy: gpsRes.accuracy ?? null,
          gpsStatus: gpsRes.gpsStatus,
          qrStatus: 'valid',
        });
        res.status(400).json({
          error: gpsRes.message,
          code: gpsRes.code,
          distanceMeters: gpsRes.distance ?? null,
          radiusMeters: session.radius_meters,
        });
        return;
      }

      qrHash = qrRes.hash;
      lat = gpsRes.lat;
      lon = gpsRes.lon;
      accuracy = gpsRes.accuracy;
      distance = gpsRes.distance;
      if (gpsRes.suspicious) gpsStatus = 'suspicious';
    }

    // Check photo requirement
    let photoStoredName: string | null = null;
    let photoStatus: 'not_required' | 'pending' = 'not_required';
    if (session.require_photo) {
      if (!photoBase64 || !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(photoBase64)) {
        await logAttempt({
          sessionId: session.id,
          outcome: 'rejected',
          rejectCode: 'PHOTO_REQUIRED',
          rejectReason: 'Phiên hoạt động yêu cầu chụp ảnh trực tiếp tại chỗ để xác minh.',
          deviceFp,
          deviceSummary,
          distance,
          accuracy,
          gpsStatus,
          qrStatus: 'valid',
        });
        res.status(400).json({
          error: 'Phiên hoạt động yêu cầu chụp ảnh trực tiếp bằng camera tại chỗ.',
          code: 'PHOTO_REQUIRED',
        });
        return;
      }
      const match = photoBase64.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
      if (match) {
        const ext = match[1] === 'png' ? '.png' : match[1] === 'webp' ? '.webp' : '.jpg';
        const buf = Buffer.from(match[2], 'base64');
        if (buf.length > 5 * 1024 * 1024) {
          res.status(400).json({ error: 'Ảnh chụp vượt quá giới hạn 5MB.', code: 'PHOTO_TOO_LARGE' });
          return;
        }
        photoStoredName = `s${session.id}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
        fs.writeFileSync(path.join(PHOTO_DIR, photoStoredName), buf);
        photoStatus = 'pending';
      }
    }

    // Check existing record on this device in this session (strictly 1 check-in per device per session)
    const existingByDevice = await db.query<{
      id: number;
      confirmation_code: string;
      status: string;
      checked_in_at: string;
      participant_name: string;
      unit_name: string;
    }>(
      `SELECT id, confirmation_code, status, checked_in_at, participant_name, unit_name FROM attendance_records
       WHERE session_id = $1 AND device_fingerprint = $2 AND status IN ('valid', 'pending_verification')
       ORDER BY checked_in_at ASC LIMIT 1`,
      [session.id, deviceFp],
    );

    if (existingByDevice.rows.length > 0) {
      if (photoStoredName) {
        const p = path.join(PHOTO_DIR, photoStoredName);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      await logAttempt({
        sessionId: session.id,
        outcome: 'rejected',
        rejectCode: 'DUPLICATE_CHECKIN',
        rejectReason: 'Thiết bị này đã điểm danh trong phiên hoạt động này (không cho phép dùng chung thiết bị).',
        deviceFp,
        deviceSummary,
        distance,
        accuracy,
        gpsStatus,
        qrStatus: 'valid',
      });
      const existing = existingByDevice.rows[0];
      res.json({
        ok: true,
        alreadyCheckedIn: true,
        message: 'Thiết bị này đã điểm danh trong phiên hoạt động này.',
        record: {
          confirmation_code: existing.confirmation_code,
          status: existing.status,
          checked_in_at: existing.checked_in_at,
          activity_title: session.title,
          participant_name: existing.participant_name,
          unit_name: existing.unit_name,
        },
      });
      return;
    }

    // Atomic idempotency key bound strictly to device_fingerprint so concurrent requests ALWAYS collapse to 1 row
    const idempotencyKey = `primary:${deviceFp}`;

    const recordStatus: 'valid' | 'pending_verification' =
      gpsStatus === 'suspicious' ? 'pending_verification' : 'valid';
    const exceptionReason =
      gpsStatus === 'suspicious'
        ? 'Tín hiệu GPS có độ chính xác bất thường — cần đối chiếu thủ công'
        : '';

    const confirmationCode = generateConfirmationCode();

    // Atomic INSERT with ON CONFLICT DO NOTHING to guarantee zero duplicates under concurrent requests
    const insertRes = await db.query<{
      id: number;
      confirmation_code: string;
      status: string;
      checked_in_at: string;
    }>(
      `INSERT INTO attendance_records
        (session_id, confirmation_code, idempotency_key, status, qr_token_hash, device_fingerprint, device_summary,
         latitude, longitude, gps_accuracy, distance_meters, gps_status, qr_status, photo_stored_name, photo_status,
         participant_name, unit_id, unit_name, participant_note, exception_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'valid', $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (session_id, idempotency_key) DO NOTHING
       RETURNING id, confirmation_code, status, checked_in_at`,
      [
        session.id,
        confirmationCode,
        idempotencyKey,
        recordStatus,
        qrHash,
        deviceFp,
        deviceSummary,
        lat,
        lon,
        accuracy,
        distance,
        gpsStatus,
        photoStoredName,
        photoStatus,
        participantName,
        unitRow.id,
        unitRow.name,
        participantNote,
        exceptionReason,
      ],
    );

    if (insertRes.rows.length === 0) {
      // Concurrent request hit unique constraint — return the already-created record cleanly
      if (photoStoredName) {
        const p = path.join(PHOTO_DIR, photoStoredName);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
      const existing = await db.query<{ confirmation_code: string; status: string; checked_in_at: string }>(
        `SELECT confirmation_code, status, checked_in_at FROM attendance_records
         WHERE session_id = $1 AND idempotency_key = $2`,
        [session.id, idempotencyKey],
      );
      res.json({
        ok: true,
        alreadyCheckedIn: true,
        message: 'Lượt điểm danh đã được ghi nhận trước đó.',
        record: {
          ...existing.rows[0],
          activity_title: session.title,
        },
      });
      return;
    }

    const created = insertRes.rows[0];
    await logAttempt({
      sessionId: session.id,
      outcome: recordStatus,
      rejectCode: sharedDevice ? 'SHARED_DEVICE_PENDING' : '',
      rejectReason: exceptionReason,
      deviceFp,
      deviceSummary,
      distance,
      accuracy,
      gpsStatus,
      qrStatus: 'valid',
    });

    res.status(201).json({
      ok: true,
      alreadyCheckedIn: false,
      message:
        recordStatus === 'pending_verification'
          ? 'ĐÃ GHI NHẬN CHỜ XÁC MINH THỦ CÔNG (Dùng chung thiết bị / ngoại lệ)'
          : 'ĐIỂM DANH THÀNH CÔNG',
      record: {
        id: created.id,
        confirmation_code: created.confirmation_code,
        status: created.status,
        checked_in_at: created.checked_in_at,
        activity_title: session.title,
        participant_name: participantName,
        unit_name: unitRow.name,
        distance_meters: distance,
      },
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Lỗi máy chủ khi ghi nhận điểm danh.' });
  }
});

// ============================================================================
// ADMIN & CÁN BỘ ĐOÀN XÃ ENDPOINTS (PROTECTED)
// ============================================================================

attendanceRouter.get('/attendance/sessions', requireAuth, requireRoles('admin', 'reviewer'), async (_req, res) => {
  try {
    const db = await getDb();
    const result = await db.query(
      `SELECT s.*,
              (SELECT COUNT(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'valid') AS valid_count,
              (SELECT COUNT(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'pending_verification') AS pending_count,
              (SELECT COUNT(*)::int FROM attendance_attempts a WHERE a.session_id = s.id AND a.outcome = 'rejected') AS rejected_count
       FROM attendance_sessions s
       ORDER BY CASE s.status WHEN 'active' THEN 1 WHEN 'paused' THEN 2 WHEN 'not_open' THEN 3 ELSE 4 END,
                s.event_date DESC, s.id DESC`,
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('List attendance sessions error:', err);
    res.status(500).json({ error: 'Không thể tải danh sách phiên điểm danh.' });
  }
});

attendanceRouter.post('/attendance/sessions', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const title = String(req.body?.title ?? '').trim();
    const description = String(req.body?.description ?? '').trim();
    const eventDate = String(req.body?.event_date ?? '').trim();
    const startTime = String(req.body?.start_time ?? '').trim();
    const endTime = String(req.body?.end_time ?? '').trim();
    const locationName = String(req.body?.location_name ?? '').trim();
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    const radiusMeters = Math.min(2000, Math.max(15, Number(req.body?.radius_meters) || 80));
    const qrRefreshSeconds = Math.min(120, Math.max(10, Number(req.body?.qr_refresh_seconds) || 20));
    const requirePhoto = Boolean(req.body?.require_photo ?? false);
    const expectedCount = Math.max(0, Number(req.body?.expected_count) || 0);
    const photoRetentionDays = Math.min(365, Math.max(1, Number(req.body?.photo_retention_days) || 30));

    if (!title || !eventDate || !startTime || !endTime || !locationName || Number.isNaN(latitude) || Number.isNaN(longitude)) {
      res.status(400).json({ error: 'Vui lòng nhập đầy đủ tên hoạt động, ngày giờ, địa điểm và tọa độ GPS.' });
      return;
    }

    const code = `DD-${eventDate.slice(0, 4)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const db = await getDb();
    const inserted = await db.query<SessionRow>(
      `INSERT INTO attendance_sessions
        (code, title, description, event_date, start_time, end_time, location_name, latitude, longitude,
         radius_meters, qr_refresh_seconds, require_photo, expected_count, photo_retention_days, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'not_open', $15)
       RETURNING *`,
      [
        code,
        title,
        description,
        eventDate,
        startTime,
        endTime,
        locationName,
        latitude,
        longitude,
        radiusMeters,
        qrRefreshSeconds,
        requirePhoto,
        expectedCount,
        photoRetentionDays,
        req.user!.id,
      ],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'CREATE_ATTENDANCE_SESSION',
      entityType: 'attendance_session',
      entityId: inserted.rows[0].id,
      summary: `Tạo phiên điểm danh QR động "${title}" tại ${locationName} (bán kính ${radiusMeters}m, làm mới QR ${qrRefreshSeconds}s)`,
    });

    res.status(201).json({ session: inserted.rows[0] });
  } catch (err) {
    console.error('Create attendance session error:', err);
    res.status(500).json({ error: 'Không thể tạo phiên điểm danh mới.' });
  }
});

attendanceRouter.patch('/attendance/sessions/:id', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const curRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
    const cur = curRes.rows[0];
    if (!cur) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }

    const title = String(req.body?.title ?? cur.title).trim();
    const description = String(req.body?.description ?? cur.description).trim();
    const eventDate = String(req.body?.event_date ?? cur.event_date).trim();
    const startTime = String(req.body?.start_time ?? cur.start_time).trim();
    const endTime = String(req.body?.end_time ?? cur.end_time).trim();
    const locationName = String(req.body?.location_name ?? cur.location_name).trim();
    const latitude = req.body?.latitude !== undefined ? Number(req.body.latitude) : cur.latitude;
    const longitude = req.body?.longitude !== undefined ? Number(req.body.longitude) : cur.longitude;
    const radiusMeters = req.body?.radius_meters !== undefined ? Math.min(2000, Math.max(15, Number(req.body.radius_meters))) : cur.radius_meters;
    const qrRefreshSeconds = req.body?.qr_refresh_seconds !== undefined ? Math.min(120, Math.max(10, Number(req.body.qr_refresh_seconds))) : cur.qr_refresh_seconds;
    const requirePhoto = req.body?.require_photo !== undefined ? Boolean(req.body.require_photo) : cur.require_photo;
    const expectedCount = req.body?.expected_count !== undefined ? Math.max(0, Number(req.body.expected_count)) : cur.expected_count;
    const photoRetentionDays = req.body?.photo_retention_days !== undefined ? Math.min(365, Math.max(1, Number(req.body.photo_retention_days))) : cur.photo_retention_days;

    const updated = await db.query<SessionRow>(
      `UPDATE attendance_sessions
       SET title = $1, description = $2, event_date = $3, start_time = $4, end_time = $5,
           location_name = $6, latitude = $7, longitude = $8, radius_meters = $9,
           qr_refresh_seconds = $10, require_photo = $11, expected_count = $12,
           photo_retention_days = $13, updated_at = NOW()
       WHERE id = $14 RETURNING *`,
      [title, description, eventDate, startTime, endTime, locationName, latitude, longitude, radiusMeters, qrRefreshSeconds, requirePhoto, expectedCount, photoRetentionDays, id],
    );

    res.json({ session: updated.rows[0] });
  } catch (err) {
    console.error('Update attendance session error:', err);
    res.status(500).json({ error: 'Không thể cập nhật phiên điểm danh.' });
  }
});

attendanceRouter.patch('/attendance/sessions/:id/status', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? '');
    if (!['not_open', 'active', 'paused', 'closed'].includes(status)) {
      res.status(400).json({ error: 'Trạng thái phiên không hợp lệ.' });
      return;
    }

    const db = await getDb();
    const updated = await db.query<SessionRow>(
      `UPDATE attendance_sessions
       SET status = $1,
           qr_secret_version = CASE WHEN $1 IN ('active', 'closed') THEN qr_secret_version + 1 ELSE qr_secret_version END,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [status, id],
    );
    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }

    await writeAuditLog({
      user: req.user!,
      action: 'UPDATE_ATTENDANCE_STATUS',
      entityType: 'attendance_session',
      entityId: id,
      summary: `Chuyển trạng thái phiên "${updated.rows[0].title}" sang "${status}"`,
    });

    res.json({ session: updated.rows[0] });
  } catch (err) {
    console.error('Update session status error:', err);
    res.status(500).json({ error: 'Không thể cập nhật trạng thái phiên.' });
  }
});

attendanceRouter.post('/attendance/sessions/:id/refresh-qr', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const updated = await db.query<SessionRow>(
      `UPDATE attendance_sessions
       SET qr_secret_version = qr_secret_version + 1, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    );
    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }
    res.json({ ok: true, qr_secret_version: updated.rows[0].qr_secret_version });
  } catch (err) {
    console.error('Refresh QR error:', err);
    res.status(500).json({ error: 'Không thể làm mới mã QR.' });
  }
});

// Generate live dynamic QR payload + PNG DataURL
attendanceRouter.get('/attendance/sessions/:id/qr', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }
    if (session.status !== 'active') {
      res.status(409).json({ error: 'Phiên điểm danh chưa ở trạng thái Đang diễn ra.' });
      return;
    }

    const qr = createDynamicQrToken(session.id, session.qr_secret_version, session.qr_refresh_seconds);
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5175';
    const checkinUrl = `${proto}://${host}/diem-danh?s=${session.id}&t=${encodeURIComponent(qr.token)}`;
    const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 520,
      color: { dark: '#003b73', light: '#ffffff' },
    });

    res.json({
      sessionId: session.id,
      token: qr.token,
      checkinUrl,
      qrDataUrl,
      issuedAt: qr.issuedAt,
      expiresAt: qr.expiresAt,
      refreshSeconds: session.qr_refresh_seconds,
    });
  } catch (err) {
    console.error('Generate QR error:', err);
    res.status(500).json({ error: 'Không thể tạo mã QR động.' });
  }
});

// Live Attendance Dashboard for a session
attendanceRouter.get('/attendance/sessions/:id/dashboard', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }

    const recordsRes = await db.query(
      `SELECT r.*, u.full_name AS reviewer_name
       FROM attendance_records r
       LEFT JOIN users u ON u.id = r.reviewed_by
       WHERE r.session_id = $1
       ORDER BY r.checked_in_at DESC`,
      [id],
    );

    const attemptsRes = await db.query(
      `SELECT * FROM attendance_attempts
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [id],
    );

    const records = recordsRes.rows;
    const attempts = attemptsRes.rows;

    const validCount = records.filter((r) => r.status === 'valid').length;
    const pendingCount = records.filter((r) => r.status === 'pending_verification').length;
    const rejectedRecordsCount = records.filter((r) => r.status === 'rejected').length;
    const rejectedAttemptsCount = attempts.filter((a) => a.outcome === 'rejected').length;
    const totalCheckins = validCount + pendingCount;
    const participationRate =
      session.expected_count > 0 ? Math.min(100, Math.round((validCount / session.expected_count) * 100)) : null;

    res.json({
      session,
      stats: {
        totalCheckins,
        validCount,
        pendingCount,
        rejectedCount: rejectedRecordsCount + rejectedAttemptsCount,
        participationRate,
      },
      records,
      attempts,
    });
  } catch (err) {
    console.error('Attendance dashboard error:', err);
    res.status(500).json({ error: 'Không thể tải dữ liệu bảng điều hành điểm danh.' });
  }
});

// Manual verification / exception handling for a record
attendanceRouter.patch('/attendance/records/:recordId/review', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    const status = String(req.body?.status ?? '');
    const photoStatus = req.body?.photo_status ? String(req.body.photo_status) : undefined;
    const exceptionReason = req.body?.exception_reason !== undefined ? String(req.body.exception_reason).trim() : undefined;

    if (!['valid', 'pending_verification', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Trạng thái xác minh không hợp lệ.' });
      return;
    }

    const db = await getDb();
    const curRes = await db.query<{ photo_status: string; exception_reason: string; confirmation_code: string }>(
      'SELECT photo_status, exception_reason, confirmation_code FROM attendance_records WHERE id = $1',
      [recordId],
    );
    if (curRes.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy lượt điểm danh.' });
      return;
    }

    const nextPhotoStatus =
      photoStatus ??
      (curRes.rows[0].photo_status === 'not_required'
        ? 'not_required'
        : status === 'valid'
          ? 'verified'
          : status === 'rejected'
            ? 'rejected'
            : 'pending');

    await db.query(
      `UPDATE attendance_records
       SET status = $1,
           photo_status = $2,
           exception_reason = $3,
           reviewed_by = $4,
           reviewed_at = NOW()
       WHERE id = $5`,
      [status, nextPhotoStatus, exceptionReason ?? curRes.rows[0].exception_reason, req.user!.id, recordId],
    );

    await writeAuditLog({
      user: req.user!,
      action: 'REVIEW_ATTENDANCE_RECORD',
      entityType: 'attendance_record',
      entityId: recordId,
      summary: `Xác minh lượt điểm danh ${curRes.rows[0].confirmation_code} → "${status}"`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Review record error:', err);
    res.status(500).json({ error: 'Không thể cập nhật trạng thái xác minh.' });
  }
});

// Protected photo access (Admin & Cán bộ Đoàn xã only)
attendanceRouter.get('/attendance/photos/:recordId', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const recordId = Number(req.params.recordId);
    const db = await getDb();
    const rRes = await db.query<{ photo_stored_name: string | null }>(
      'SELECT photo_stored_name FROM attendance_records WHERE id = $1',
      [recordId],
    );
    const stored = rRes.rows[0]?.photo_stored_name;
    if (!stored) {
      res.status(404).json({ error: 'Lượt điểm danh này không có ảnh xác minh.' });
      return;
    }
    const fullPath = path.join(PHOTO_DIR, path.basename(stored));
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Ảnh xác minh đã được xóa theo chính sách lưu trữ.' });
      return;
    }
    const ext = path.extname(stored).toLowerCase();
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    console.error('Get attendance photo error:', err);
    res.status(500).json({ error: 'Không thể tải ảnh xác minh.' });
  }
});

// Purge expired attendance photos according to retention policy
attendanceRouter.post('/attendance/sessions/:id/purge-photos', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const rows = await db.query<{ id: number; photo_stored_name: string }>(
      `SELECT id, photo_stored_name FROM attendance_records
       WHERE session_id = $1 AND photo_stored_name IS NOT NULL`,
      [id],
    );
    let removed = 0;
    for (const r of rows.rows) {
      const fullPath = path.join(PHOTO_DIR, path.basename(r.photo_stored_name));
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        removed += 1;
      }
      await db.query('UPDATE attendance_records SET photo_stored_name = NULL WHERE id = $1', [r.id]);
    }
    await writeAuditLog({
      user: req.user!,
      action: 'PURGE_ATTENDANCE_PHOTOS',
      entityType: 'attendance_session',
      entityId: id,
      summary: `Xóa ${removed} ảnh xác minh của phiên điểm danh #${id} theo chính sách bảo vệ dữ liệu cá nhân`,
    });
    res.json({ ok: true, removed });
  } catch (err) {
    console.error('Purge photos error:', err);
    res.status(500).json({ error: 'Không thể xóa ảnh xác minh.' });
  }
});

// Export attendance session to Excel (.xlsx)
attendanceRouter.get('/attendance/sessions/:id/export/excel', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const sRes = await db.query<SessionRow>('SELECT * FROM attendance_sessions WHERE id = $1', [id]);
    const session = sRes.rows[0];
    if (!session) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }

    const recordsRes = await db.query<{
      confirmation_code: string;
      participant_name: string;
      unit_name: string;
      status: string;
      checked_in_at: string;
      distance_meters: number | null;
      gps_status: string;
      qr_status: string;
      device_summary: string;
      photo_status: string;
      participant_note: string;
      exception_reason: string;
    }>(
      `SELECT confirmation_code, participant_name, unit_name, status, checked_in_at, distance_meters, gps_status, qr_status,
              device_summary, photo_status, participant_note, exception_reason
       FROM attendance_records
       WHERE session_id = $1
       ORDER BY checked_in_at ASC`,
      [id],
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dashboard Tuổi trẻ Tân Nhựt';
    const ws = wb.addWorksheet('Điểm danh QR động');

    ws.mergeCells('A1:L1');
    ws.getCell('A1').value = 'ĐOÀN TNCS HỒ CHÍ MINH XÃ TÂN NHỰT – DASHBOARD TUỔI TRẺ TÂN NHỰT';
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF005BAA' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells('A2:L2');
    ws.getCell('A2').value = `BÁO CÁO ĐIỂM DANH HOẠT ĐỘNG: ${session.title.toUpperCase()}`;
    ws.getCell('A2').font = { bold: true, size: 12 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    ws.mergeCells('A3:L3');
    ws.getCell('A3').value = `Ngày ${session.event_date} (${session.start_time} – ${session.end_time}) | Địa điểm: ${session.location_name} | Bán kính GPS: ${session.radius_meters}m`;
    ws.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    ws.getCell('A3').alignment = { horizontal: 'center' };

    ws.addRow([]);

    const header = ws.addRow([
      'STT',
      'Mã xác nhận',
      'Họ và tên',
      'Chi đoàn / Cơ sở Đoàn',
      'Thời gian điểm danh',
      'Trạng thái lượt',
      'Trạng thái GPS',
      'Khoảng cách (m)',
      'Trạng thái QR',
      'Thiết bị',
      'Xác minh ảnh',
      'Ghi chú / Ngoại lệ',
    ]);
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF005BAA' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    header.height = 26;

    const statusVi: Record<string, string> = {
      valid: 'Hợp lệ',
      pending_verification: 'Chờ xác minh',
      rejected: 'Từ chối',
    };
    const photoVi: Record<string, string> = {
      not_required: 'Không yêu cầu',
      pending: 'Chờ đối chiếu',
      verified: 'Đã đối chiếu',
      rejected: 'Không đạt',
    };

    recordsRes.rows.forEach((r, idx) => {
      ws.addRow([
        idx + 1,
        r.confirmation_code,
        r.participant_name || '—',
        r.unit_name || '—',
        new Date(r.checked_in_at).toLocaleString('vi-VN'),
        statusVi[r.status] ?? r.status,
        r.gps_status === 'valid' ? 'Hợp lệ' : r.gps_status,
        r.distance_meters ?? '—',
        r.qr_status === 'valid' ? 'Hợp lệ' : r.qr_status,
        r.device_summary,
        photoVi[r.photo_status] ?? r.photo_status,
        [r.participant_note, r.exception_reason].filter(Boolean).join(' | '),
      ]);
    });

    ws.columns = [
      { width: 6 },
      { width: 15 },
      { width: 24 },
      { width: 32 },
      { width: 22 },
      { width: 16 },
      { width: 15 },
      { width: 16 },
      { width: 14 },
      { width: 18 },
      { width: 16 },
      { width: 36 },
    ];

    const filename = `Diem-danh-${session.code}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export attendance Excel error:', err);
    res.status(500).json({ error: 'Không thể xuất báo cáo điểm danh Excel.' });
  }
});

attendanceRouter.delete('/attendance/sessions/:id', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = await getDb();
    const sRes = await db.query<{ title: string }>('SELECT title FROM attendance_sessions WHERE id = $1', [id]);
    if (sRes.rows.length === 0) {
      res.status(404).json({ error: 'Không tìm thấy phiên điểm danh.' });
      return;
    }
    // Remove photos from disk
    const photos = await db.query<{ photo_stored_name: string }>(
      'SELECT photo_stored_name FROM attendance_records WHERE session_id = $1 AND photo_stored_name IS NOT NULL',
      [id],
    );
    for (const p of photos.rows) {
      const fullPath = path.join(PHOTO_DIR, path.basename(p.photo_stored_name));
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await db.query('DELETE FROM attendance_sessions WHERE id = $1', [id]);
    await writeAuditLog({
      user: req.user!,
      action: 'DELETE_ATTENDANCE_SESSION',
      entityType: 'attendance_session',
      entityId: id,
      summary: `Xóa phiên điểm danh "${sRes.rows[0].title}"`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete attendance session error:', err);
    res.status(500).json({ error: 'Không thể xóa phiên điểm danh.' });
  }
});
