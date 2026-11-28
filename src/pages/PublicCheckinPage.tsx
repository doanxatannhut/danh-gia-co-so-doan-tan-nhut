import React, { useEffect, useRef, useState } from 'react';
import {
  Award,
  QrCode,
  MapPin,
  Camera,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Loader2,
  Users,
  Clock,
} from 'lucide-react';
import { formatDateTime } from '../utils/api';

interface PublicSession {
  id: number;
  code: string;
  title: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location_name: string;
  radius_meters: number;
  require_photo: boolean;
  status: 'not_open' | 'active' | 'paused' | 'closed';
}

type CheckinScreen = 'landing' | 'verify' | 'submitting' | 'result';

function getOrCreateClientDeviceToken(): string {
  const key = 'tttn_client_dev_v1';
  try {
    let val = window.localStorage.getItem(key);
    if (!val) {
      const arr = new Uint8Array(16);
      window.crypto.getRandomValues(arr);
      val = Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(key, val);
    }
    return val;
  } catch {
    return 'ephemeral-device';
  }
}

export const PublicCheckinPage: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const initialSessionId = params.get('s') ? Number(params.get('s')) : null;
  const initialToken = params.get('t') || '';

  const [screen, setScreen] = useState<CheckinScreen>(initialSessionId && initialToken ? 'verify' : 'landing');
  const [activeSessions, setActiveSessions] = useState<PublicSession[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(initialSessionId);
  const [qrToken, setQrToken] = useState<string>(initialToken);
  const [session, setSession] = useState<PublicSession | null>(null);

  // QR Scanner state (Screen 1)
  const [scanningQr, setScanningQr] = useState(false);
  const [scanError, setScanError] = useState('');
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);

  // GPS state (Screen 2)
  const [gpsState, setGpsState] = useState<'idle' | 'locating' | 'verified' | 'error'>('idle');
  const [gpsMessage, setGpsMessage] = useState('');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [distanceMeters, setDistanceMeters] = useState<number | null>(null);
  const [verifyTicket, setVerifyTicket] = useState('');
  const [existingCheckin, setExistingCheckin] = useState<{
    confirmation_code: string;
    checked_in_at: string;
    status: string;
  } | null>(null);

  // Shared device exception mode
  const [sharedDeviceMode, setSharedDeviceMode] = useState(false);
  const [participantNote, setParticipantNote] = useState('');

  // Live Camera Photo state (Screen 2 when require_photo = true)
  const [cameraActive, setCameraActive] = useState(false);
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [cameraError, setCameraError] = useState('');
  const photoVideoRef = useRef<HTMLVideoElement | null>(null);
  const photoStreamRef = useRef<MediaStream | null>(null);

  // Result state (Screen 3)
  const [result, setResult] = useState<{
    success: boolean;
    alreadyCheckedIn?: boolean;
    pendingVerification?: boolean;
    title: string;
    message: string;
    activityTitle?: string;
    confirmationCode?: string;
    checkedInAt?: string;
    distanceMeters?: number | null;
    canRetry?: boolean;
  } | null>(null);

  const clientDeviceToken = useRef(getOrCreateClientDeviceToken());
  const idempotencyKeyRef = useRef<string>(
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  // Cleanup camera streams on unmount
  useEffect(() => {
    return () => {
      qrStreamRef.current?.getTracks().forEach((t) => t.stop());
      photoStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Load active sessions for Screen 1
  useEffect(() => {
    if (screen === 'landing') {
      fetch('/api/public/attendance/active')
        .then((r) => r.json())
        .then((d) => setActiveSessions(d.sessions || []))
        .catch(() => {});
    }
  }, [screen]);

  // Load session info & auto-start GPS verification on Screen 2
  useEffect(() => {
    if (screen !== 'verify' || !sessionId || !qrToken) return;
    let cancelled = false;

    async function initVerify() {
      try {
        const res = await fetch(
          `/api/public/attendance/session-info?s=${sessionId}&t=${encodeURIComponent(qrToken)}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setResult({
            success: false,
            title: 'KHÔNG THỂ ĐIỂM DANH',
            message: data.error || 'Không tìm thấy phiên điểm danh.',
            canRetry: false,
          });
          setScreen('result');
          return;
        }
        setSession(data.session);

        if (data.session.status !== 'active') {
          const msg =
            data.session.status === 'closed'
              ? 'Phiên điểm danh đã kết thúc. Không thể tiếp tục điểm danh.'
              : data.session.status === 'paused'
                ? 'Phiên điểm danh đang tạm dừng. Vui lòng chờ cán bộ phụ trách mở lại.'
                : 'Phiên điểm danh chưa được mở.';
          setResult({
            success: false,
            title: 'PHIÊN KHÔNG KHẢ DỤNG',
            message: msg,
            activityTitle: data.session.title,
            canRetry: data.session.status !== 'closed',
          });
          setScreen('result');
          return;
        }

        if (!data.qrCheck?.valid) {
          setResult({
            success: false,
            title: 'MÃ QR KHÔNG HỢP LỆ / ĐÃ HẾT HẠN',
            message: data.qrCheck?.message || 'Mã QR đã hết hạn. Vui lòng quét lại mã QR mới nhất trên màn hình.',
            activityTitle: data.session.title,
            canRetry: true,
          });
          setScreen('result');
          return;
        }

        requestGpsVerification(data.session.id, qrToken);
      } catch {
        if (!cancelled) {
          setResult({
            success: false,
            title: 'LỖI KẾT NỐI MẠNG',
            message: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra Internet và thử lại.',
            canRetry: true,
          });
          setScreen('result');
        }
      }
    }

    initVerify();
    return () => {
      cancelled = true;
    };
  }, [screen, sessionId, qrToken]);

  async function startQrScanner() {
    setScanError('');
    const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!navigator.mediaDevices?.getUserMedia || !BarcodeDetectorCtor) {
      setScanError(
        'Trình duyệt của bạn không hỗ trợ quét QR trực tiếp trong trang. Vui lòng mở ứng dụng Camera hoặc Zalo trên điện thoại để quét mã QR đang chiếu trên màn hình.',
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      qrStreamRef.current = stream;
      setScanningQr(true);
      window.setTimeout(() => {
        if (qrVideoRef.current) {
          qrVideoRef.current.srcObject = stream;
          qrVideoRef.current.play().catch(() => {});
        }
      }, 100);

      const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
      const timer = window.setInterval(async () => {
        if (!qrVideoRef.current || qrVideoRef.current.readyState < 2) return;
        try {
          const codes = await detector.detect(qrVideoRef.current);
          if (codes.length > 0) {
            const raw = codes[0].rawValue;
            const parsed = new URL(raw, window.location.origin);
            const s = parsed.searchParams.get('s');
            const t = parsed.searchParams.get('t');
            if (s && t) {
              window.clearInterval(timer);
              stream.getTracks().forEach((tr) => tr.stop());
              setScanningQr(false);
              setSessionId(Number(s));
              setQrToken(t);
              window.history.replaceState({}, '', `/diem-danh?s=${s}&t=${encodeURIComponent(t)}`);
              setScreen('verify');
            }
          }
        } catch {
          // keep scanning
        }
      }, 350);
    } catch {
      setScanError('Không thể mở camera để quét QR. Hãy cấp quyền Camera hoặc dùng ứng dụng Camera mặc định của điện thoại.');
    }
  }

  function stopQrScanner() {
    qrStreamRef.current?.getTracks().forEach((t) => t.stop());
    setScanningQr(false);
  }

  function requestGpsVerification(sid: number, tokenVal: string) {
    setGpsState('locating');
    setGpsMessage('Đang yêu cầu quyền truy cập vị trí GPS...');
    setVerifyTicket('');

    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsMessage('Không thể xác định vị trí. Vui lòng bật định vị và thử lại.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        setGpsCoords({ lat, lon, accuracy });

        try {
          const res = await fetch('/api/public/attendance/verify-gps', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sid,
              token: tokenVal,
              latitude: lat,
              longitude: lon,
              accuracy,
              client_device_token: clientDeviceToken.current,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setGpsState('error');
            setDistanceMeters(data.distanceMeters ?? null);
            setGpsMessage(data.error || 'Không thể xác thực vị trí.');
            return;
          }

          setGpsState('verified');
          setGpsMessage(data.message || 'Đã xác nhận vị trí, vui lòng hoàn tất điểm danh.');
          setDistanceMeters(data.distanceMeters ?? null);
          setVerifyTicket(data.verifyTicket || '');
          setExistingCheckin(data.existingCheckin || null);
        } catch {
          setGpsState('error');
          setGpsMessage('Mất kết nối mạng khi xác thực vị trí. Vui lòng kiểm tra Internet và thử lại.');
        }
      },
      () => {
        setGpsState('error');
        setGpsMessage('Không thể xác định vị trí. Vui lòng bật định vị và thử lại.');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function startLivePhotoCamera() {
    setCameraError('');
    setPhotoDataUrl('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Trình duyệt không hỗ trợ camera trực tiếp. Vui lòng dùng Chrome/Safari trên điện thoại.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      photoStreamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (photoVideoRef.current) {
          photoVideoRef.current.srcObject = stream;
          photoVideoRef.current.play().catch(() => {});
        }
      }, 100);
    } catch {
      setCameraError('Không thể truy cập camera. Vui lòng cấp quyền Camera để chụp ảnh xác minh tại chỗ.');
    }
  }

  function captureLivePhoto() {
    const video = photoVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    const maxDim = 720;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth || 640, video.videoHeight || 480));
    canvas.width = Math.round((video.videoWidth || 640) * scale);
    canvas.height = Math.round((video.videoHeight || 480) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    setPhotoDataUrl(dataUrl);
    photoStreamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraActive(false);
  }

  async function submitCheckin(isShared = false) {
    if (!session || !sessionId) return;
    if (session.require_photo && !photoDataUrl) {
      setCameraError('Vui lòng chụp ảnh trực tiếp tại chỗ trước khi xác nhận điểm danh.');
      return;
    }

    setScreen('submitting');
    try {
      const res = await fetch('/api/public/attendance/checkin', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          token: qrToken,
          verify_ticket: verifyTicket,
          latitude: gpsCoords?.lat,
          longitude: gpsCoords?.lon,
          accuracy: gpsCoords?.accuracy,
          client_device_token: clientDeviceToken.current,
          idempotency_key: isShared ? `${idempotencyKeyRef.current}-shared` : idempotencyKeyRef.current,
          shared_device: isShared,
          participant_note: participantNote,
          photo_data_url: photoDataUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({
          success: false,
          title: 'ĐIỂM DANH KHÔNG THÀNH CÔNG',
          message: data.error || 'Không thể ghi nhận điểm danh.',
          activityTitle: session.title,
          distanceMeters: data.distanceMeters ?? null,
          canRetry: data.code !== 'SESSION_CLOSED',
        });
        setScreen('result');
        return;
      }

      setResult({
        success: true,
        alreadyCheckedIn: Boolean(data.alreadyCheckedIn),
        pendingVerification: data.record?.status === 'pending_verification',
        title: data.record?.status === 'pending_verification'
          ? 'ĐÃ GHI NHẬN CHỜ XÁC MINH'
          : data.alreadyCheckedIn
            ? 'ĐÃ ĐIỂM DANH TRƯỚC ĐÓ'
            : 'ĐIỂM DANH THÀNH CÔNG',
        message: data.message,
        activityTitle: data.record?.activity_title || session.title,
        confirmationCode: data.record?.confirmation_code,
        checkedInAt: data.record?.checked_in_at,
        distanceMeters: data.record?.distance_meters ?? distanceMeters,
      });
      setScreen('result');
    } catch {
      setResult({
        success: false,
        title: 'MẤT KẾT NỐI MẠNG',
        message: 'Không nhận được xác nhận từ máy chủ. Lượt điểm danh chưa được ghi nhận — vui lòng kiểm tra mạng và thử lại.',
        activityTitle: session.title,
        canRetry: true,
      });
      setScreen('result');
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] flex flex-col">
      {/* Compact Brand Header */}
      <header className="youth-gradient text-white px-4 py-4 shadow-sm">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Award className="w-5 h-5 text-amber-300" />
            </div>
            <div>
              <div className="text-xs font-bold tracking-wider uppercase text-amber-300">
                Tuổi trẻ Tân Nhựt
              </div>
              <div className="text-sm font-bold leading-tight">Điểm danh QR động</div>
            </div>
          </div>
          <a
            href="/"
            className="text-xs px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 transition"
          >
            Trang chủ
          </a>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 max-w-md w-full mx-auto space-y-5">
        {/* ==================== MÀN HÌNH 1: LANDING / QUÉT QR ==================== */}
        {screen === 'landing' && (
          <div className="space-y-4">
            <div className="card-surface p-6 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl youth-gradient text-white flex items-center justify-center shadow-md">
                <QrCode className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Điểm danh hoạt động Đoàn</h1>
                <p className="text-xs text-[var(--text-secondary)] mt-1">
                  Không cần đăng nhập • Không cần nhập mã đoàn viên • Xác thực QR động & GPS tại địa điểm tổ chức.
                </p>
              </div>

              {activeSessions.length > 0 && (
                <div className="text-left p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-1.5">
                  <div className="text-[11px] font-bold uppercase text-[#005baa] dark:text-sky-400">
                    Hoạt động đang diễn ra ({activeSessions.length})
                  </div>
                  {activeSessions.map((s) => (
                    <div key={s.id} className="text-xs">
                      <div className="font-bold text-[var(--text-primary)]">{s.title}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">
                        {s.location_name} • {s.start_time} – {s.end_time}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!scanningQr ? (
                <button
                  type="button"
                  onClick={startQrScanner}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#005baa] hover:bg-[#004a8c] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
                >
                  <QrCode className="w-5 h-5" />
                  QUÉT MÃ QR ĐIỂM DANH
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-xl overflow-hidden bg-black aspect-square">
                    <video ref={qrVideoRef} playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute inset-8 border-2 border-amber-400 rounded-xl pointer-events-none" />
                  </div>
                  <button
                    type="button"
                    onClick={stopQrScanner}
                    className="w-full py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold cursor-pointer"
                  >
                    Đóng camera quét QR
                  </button>
                </div>
              )}

              {scanError && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs text-left">
                  {scanError}
                </div>
              )}
            </div>

            <div className="card-surface p-4 text-xs text-[var(--text-secondary)] space-y-1.5">
              <div className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#005baa]" />
                Hướng dẫn nhanh
              </div>
              <p>1. Mở Camera điện thoại (hoặc bấm nút trên) quét trực tiếp mã QR động đang chiếu trên màn hình tại địa điểm.</p>
              <p>2. Cho phép trình duyệt truy cập <strong>Vị trí (GPS)</strong> để xác nhận bạn đang có mặt trực tiếp.</p>
              <p>3. Chụp ảnh trực tiếp (nếu hoạt động yêu cầu) và nhấn <strong>Hoàn tất điểm danh</strong>.</p>
            </div>
          </div>
        )}

        {/* ==================== MÀN HÌNH 2: XÁC THỰC GPS & ẢNH ==================== */}
        {screen === 'verify' && (
          <div className="space-y-4">
            {session && (
              <div className="card-surface p-5 space-y-1.5">
                <div className="text-[11px] font-bold uppercase text-[#005baa] dark:text-sky-400">
                  {session.code} • {session.event_date} ({session.start_time} – {session.end_time})
                </div>
                <h1 className="text-lg font-bold leading-snug">{session.title}</h1>
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0 text-[#005baa]" />
                  <span>{session.location_name} (Phạm vi: {session.radius_meters}m)</span>
                </div>
              </div>
            )}

            {/* Step A: GPS Status */}
            <div className="card-surface p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-[var(--text-secondary)]">
                  Bước 1 · Xác thực vị trí GPS
                </span>
                {gpsState === 'verified' && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                    Hợp lệ {distanceMeters !== null ? `(${distanceMeters}m)` : ''}
                  </span>
                )}
              </div>

              {gpsState === 'locating' && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  <span>{gpsMessage}</span>
                </div>
              )}

              {gpsState === 'verified' && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium">
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
                  <span>{gpsMessage}</span>
                </div>
              )}

              {gpsState === 'error' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-medium">
                    <XCircle className="w-5 h-5 shrink-0 text-red-600" />
                    <div>
                      <div>{gpsMessage}</div>
                      {distanceMeters !== null && session && (
                        <div className="mt-1 text-[11px] opacity-90">
                          Khoảng cách hiện tại: <strong>{distanceMeters}m</strong> (cho phép tối đa {session.radius_meters}m).
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => sessionId && requestGpsVerification(sessionId, qrToken)}
                    className="w-full py-2.5 px-4 rounded-xl border border-[#005baa] text-[#005baa] dark:text-sky-400 font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" /> Thử xác thực GPS lại
                  </button>
                </div>
              )}
            </div>

            {/* Already Checked In on This Device Notice + Shared Device Option */}
            {gpsState === 'verified' && existingCheckin && !sharedDeviceMode && (
              <div className="card-surface p-5 space-y-3 border-amber-300 dark:border-amber-700">
                <div className="flex items-start gap-2.5 text-amber-900 dark:text-amber-200 text-xs">
                  <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <div className="font-bold">Thiết bị này đã ghi nhận điểm danh trong phiên!</div>
                    <div className="mt-1">
                      Mã xác nhận trước đó: <strong className="font-mono">{existingCheckin.confirmation_code}</strong> lúc{' '}
                      {formatDateTime(existingCheckin.checked_in_at)}.
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2">
                  <div className="text-[11px] text-[var(--text-secondary)]">
                    Nếu bạn là <strong>người khác đang mượn chung điện thoại</strong> tại địa điểm tổ chức, hãy chọn nút dưới để gửi lượt điểm danh sang chế độ <strong>cán bộ phụ trách xác minh thủ công</strong>:
                  </div>
                  <button
                    type="button"
                    onClick={() => setSharedDeviceMode(true)}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Users className="w-4 h-4" />
                    Tôi dùng chung thiết bị — Gửi xác minh thủ công
                  </button>
                </div>
              </div>
            )}

            {/* Shared Device Note Input */}
            {gpsState === 'verified' && sharedDeviceMode && (
              <div className="card-surface p-4 space-y-2 border-amber-300 dark:border-amber-700">
                <label className="block text-xs font-bold text-amber-800 dark:text-amber-300">
                  Ghi chú cho cán bộ phụ trách xác minh (Dùng chung thiết bị)
                </label>
                <input
                  type="text"
                  value={participantNote}
                  onChange={(e) => setParticipantNote(e.target.value)}
                  placeholder="Ví dụ: Đoàn viên Ấp 10 mượn điện thoại bạn ngồi kế bên..."
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs"
                />
              </div>
            )}

            {/* Step B: Live Camera Photo (only when require_photo = true) */}
            {gpsState === 'verified' && session?.require_photo && (!existingCheckin || sharedDeviceMode) && (
              <div className="card-surface p-5 space-y-3">
                <div className="text-xs font-bold uppercase text-[var(--text-secondary)] flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-[#005baa]" />
                  Bước 2 · Xác minh ảnh trực tiếp tại chỗ (Bắt buộc)
                </div>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Hệ thống chỉ chấp nhận ảnh chụp trực tiếp bằng camera tại thời điểm điểm danh (không tải ảnh từ thư viện). Ảnh chỉ dùng hỗ trợ cán bộ đối chiếu sự hiện diện và được xóa định kỳ.
                </p>

                {cameraError && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs">
                    {cameraError}
                  </div>
                )}

                {!cameraActive && !photoDataUrl && (
                  <button
                    type="button"
                    onClick={startLivePhotoCamera}
                    className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Camera className="w-4 h-4" /> Mở camera chụp ảnh tại chỗ
                  </button>
                )}

                {cameraActive && (
                  <div className="space-y-2.5">
                    <div className="rounded-xl overflow-hidden bg-black aspect-[4/3]">
                      <video ref={photoVideoRef} playsInline muted className="w-full h-full object-cover" />
                    </div>
                    <button
                      type="button"
                      onClick={captureLivePhoto}
                      className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    >
                      Chụp ảnh xác minh
                    </button>
                  </div>
                )}

                {photoDataUrl && (
                  <div className="space-y-2">
                    <img src={photoDataUrl} alt="Ảnh xác minh tại chỗ" className="w-full rounded-xl border border-[var(--border-subtle)]" />
                    <button
                      type="button"
                      onClick={startLivePhotoCamera}
                      className="w-full py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold cursor-pointer"
                    >
                      Chụp lại ảnh khác
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Confirm Check-in Button */}
            {gpsState === 'verified' && (!existingCheckin || sharedDeviceMode) && (
              <button
                type="button"
                disabled={Boolean(session?.require_photo && !photoDataUrl)}
                onClick={() => submitCheckin(sharedDeviceMode)}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-sm disabled:opacity-50 transition cursor-pointer"
              >
                {sharedDeviceMode ? 'GỬI XÁC MINH ĐIỂM DANH' : 'HOÀN TẤT ĐIỂM DANH'}
              </button>
            )}
          </div>
        )}

        {/* ==================== MÀN HÌNH 3A: ĐANG XÁC THỰC ==================== */}
        {screen === 'submitting' && (
          <div className="card-surface p-10 text-center space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-[#005baa] animate-spin" />
            <div className="font-bold text-base">Đang xác thực với máy chủ...</div>
            <p className="text-xs text-[var(--text-secondary)]">
              Hệ thống đang kiểm tra mã QR động, tọa độ GPS và ghi nhận lượt điểm danh của bạn. Vui lòng không đóng trang.
            </p>
          </div>
        )}

        {/* ==================== MÀN HÌNH 3B: KẾT QUẢ ==================== */}
        {screen === 'result' && result && (
          <div className="card-surface p-6 text-center space-y-4">
            {result.success ? (
              <div
                className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center ${
                  result.pendingVerification
                    ? 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300'
                }`}
              >
                {result.pendingVerification ? <Clock className="w-9 h-9" /> : <CheckCircle2 className="w-9 h-9" />}
              </div>
            ) : (
              <div className="w-16 h-16 mx-auto rounded-full bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-300 flex items-center justify-center">
                <XCircle className="w-9 h-9" />
              </div>
            )}

            <div>
              <h2
                className={`text-lg font-extrabold ${
                  result.success
                    ? result.pendingVerification
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-emerald-700 dark:text-emerald-300'
                    : 'text-red-700 dark:text-red-400'
                }`}
              >
                {result.title}
              </h2>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{result.message}</p>
            </div>

            {result.success && (
              <div className="p-4 rounded-xl bg-[var(--bg-subtle)] text-left space-y-2 text-xs">
                {result.activityTitle && (
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--text-secondary)]">Hoạt động:</span>
                    <strong className="text-right">{result.activityTitle}</strong>
                  </div>
                )}
                {result.confirmationCode && (
                  <div className="flex justify-between gap-2 items-center">
                    <span className="text-[var(--text-secondary)]">Mã xác nhận:</span>
                    <span className="px-2.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 font-mono font-bold text-sm">
                      {result.confirmationCode}
                    </span>
                  </div>
                )}
                {result.checkedInAt && (
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--text-secondary)]">Thời gian xác nhận:</span>
                    <strong>{formatDateTime(result.checkedInAt)}</strong>
                  </div>
                )}
                {result.distanceMeters !== null && result.distanceMeters !== undefined && (
                  <div className="flex justify-between gap-2">
                    <span className="text-[var(--text-secondary)]">Khoảng cách GPS:</span>
                    <strong>{result.distanceMeters} m</strong>
                  </div>
                )}
              </div>
            )}

            {!result.success && result.canRetry && (
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setScreen('landing');
                  window.history.replaceState({}, '', '/diem-danh');
                }}
                className="w-full py-3 rounded-xl bg-[#005baa] hover:bg-[#004a8c] text-white font-bold text-xs cursor-pointer"
              >
                Quét lại mã QR mới nhất
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
