import React, { useCallback, useEffect, useState } from 'react';
import {
  QrCode,
  Plus,
  Play,
  Pause,
  Square,
  RefreshCw,
  Maximize2,
  X,
  MapPin,
  FileSpreadsheet,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  ShieldAlert,
  Trash2,
  Search,
  Edit3,
  Camera,
  ExternalLink,
  Info,
} from 'lucide-react';
import { apiFetch, formatDateTime } from '../utils/api';

interface AttendanceSession {
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
  photo_retention_days: number;
  status: 'not_open' | 'active' | 'paused' | 'closed';
  valid_count?: number;
  pending_count?: number;
  rejected_count?: number;
}

interface AttendanceRecord {
  id: number;
  session_id: number;
  confirmation_code: string;
  participant_name: string;
  unit_id: number | null;
  unit_name: string;
  status: 'valid' | 'pending_verification' | 'rejected';
  device_summary: string;
  distance_meters: number | null;
  gps_accuracy: number | null;
  gps_status: string;
  qr_status: string;
  photo_stored_name: string | null;
  photo_status: string;
  participant_note: string;
  exception_reason: string;
  reviewer_name?: string | null;
  checked_in_at: string;
}

interface AttendanceAttempt {
  id: number;
  outcome: 'valid' | 'pending_verification' | 'rejected';
  reject_code: string;
  reject_reason: string;
  device_summary: string;
  distance_meters: number | null;
  gps_status: string;
  qr_status: string;
  created_at: string;
}

interface SessionDashboardData {
  session: AttendanceSession;
  stats: {
    totalCheckins: number;
    validCount: number;
    pendingCount: number;
    rejectedCount: number;
    participationRate: number | null;
  };
  records: AttendanceRecord[];
  attempts: AttendanceAttempt[];
}

interface LiveQrPayload {
  sessionId: number;
  token: string;
  checkinUrl: string;
  qrDataUrl: string;
  issuedAt: string;
  expiresAt: string;
  refreshSeconds: number;
}

const SESSION_STATUS_META: Record<
  AttendanceSession['status'],
  { label: string; cls: string }
> = {
  not_open: { label: 'Chưa mở', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300' },
  active: { label: 'Đang diễn ra', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300' },
  paused: { label: 'Tạm dừng', cls: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300' },
  closed: { label: 'Đã kết thúc', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300' },
};

export const AttendanceAdminPage: React.FC = () => {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dash, setDash] = useState<SessionDashboardData | null>(null);
  const [liveQr, setLiveQr] = useState<LiveQrPayload | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [ledFullscreen, setLedFullscreen] = useState(false);

  const [listTab, setListTab] = useState<'records' | 'attempts'>('records');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // Create / Edit session modal
  const [showModal, setShowModal] = useState(false);
  const [editingSession, setEditingSession] = useState<AttendanceSession | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    event_date: new Date().toISOString().slice(0, 10),
    start_time: '07:30',
    end_time: '11:30',
    location_name: 'Hội trường UBND xã Tân Nhựt',
    latitude: '10.7155',
    longitude: '106.5642',
    radius_meters: '80',
    qr_refresh_seconds: '20',
    require_photo: false,
    expected_count: '50',
    photo_retention_days: '30',
  });

  // Photo viewer modal
  const [photoPreviewRecord, setPhotoPreviewRecord] = useState<AttendanceRecord | null>(null);

  function showToastMsg(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3500);
  }

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiFetch<{ sessions: AttendanceSession[] }>('/api/attendance/sessions');
      setSessions(res.sessions);
      setSelectedId((prev) => {
        if (prev && res.sessions.some((s) => s.id === prev)) return prev;
        return res.sessions[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải danh sách phiên điểm danh.');
    }
  }, []);

  const loadDashboard = useCallback(async (id: number | null) => {
    if (!id) {
      setDash(null);
      return;
    }
    try {
      const res = await apiFetch<SessionDashboardData>(`/api/attendance/sessions/${id}/dashboard`);
      setDash(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu phiên.');
    }
  }, []);

  const fetchLiveQr = useCallback(async (id: number) => {
    try {
      const res = await apiFetch<LiveQrPayload>(`/api/attendance/sessions/${id}/qr`);
      setLiveQr(res);
      const secLeft = Math.max(1, Math.round((new Date(res.expiresAt).getTime() - Date.now()) / 1000));
      setCountdown(secLeft);
    } catch {
      setLiveQr(null);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (selectedId) {
      loadDashboard(selectedId);
    }
  }, [selectedId, loadDashboard]);

  // Auto-poll dashboard every 5s when session is active
  useEffect(() => {
    if (!selectedId || dash?.session.status !== 'active') return;
    const t = window.setInterval(() => {
      loadDashboard(selectedId);
    }, 5000);
    return () => window.clearInterval(t);
  }, [selectedId, dash?.session.status, loadDashboard]);

  // Fetch & auto-rotate dynamic QR when session is active
  useEffect(() => {
    if (!selectedId || dash?.session.status !== 'active') {
      setLiveQr(null);
      setCountdown(0);
      return;
    }
    fetchLiveQr(selectedId);
  }, [selectedId, dash?.session.status, fetchLiveQr]);

  // Countdown tick every second; auto-fetch new QR on 0 without page reload
  useEffect(() => {
    if (!liveQr || !selectedId || dash?.session.status !== 'active') return;
    const timer = window.setInterval(() => {
      const left = Math.ceil((new Date(liveQr.expiresAt).getTime() - Date.now()) / 1000);
      if (left <= 0) {
        fetchLiveQr(selectedId);
      } else {
        setCountdown(left);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [liveQr, selectedId, dash?.session.status, fetchLiveQr]);

  function openNewModal() {
    setEditingSession(null);
    setForm({
      title: '',
      description: '',
      event_date: new Date().toISOString().slice(0, 10),
      start_time: '07:30',
      end_time: '11:30',
      location_name: 'Hội trường UBND xã Tân Nhựt',
      latitude: '10.7155',
      longitude: '106.5642',
      radius_meters: '80',
      qr_refresh_seconds: '20',
      require_photo: false,
      expected_count: '50',
      photo_retention_days: '30',
    });
    setShowModal(true);
  }

  function openEditModal(s: AttendanceSession) {
    setEditingSession(s);
    setForm({
      title: s.title,
      description: s.description,
      event_date: s.event_date,
      start_time: s.start_time,
      end_time: s.end_time,
      location_name: s.location_name,
      latitude: String(s.latitude),
      longitude: String(s.longitude),
      radius_meters: String(s.radius_meters),
      qr_refresh_seconds: String(s.qr_refresh_seconds),
      require_photo: s.require_photo,
      expected_count: String(s.expected_count),
      photo_retention_days: String(s.photo_retention_days),
    });
    setShowModal(true);
  }

  function fillCurrentGps() {
    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ lấy tọa độ GPS.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((prev) => ({
          ...prev,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        showToastMsg('Đã lấy tọa độ GPS hiện tại.');
      },
      () => setError('Không thể lấy tọa độ GPS hiện tại. Hãy cấp quyền vị trí hoặc nhập thủ công.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function handleSaveSession(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        ...form,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radius_meters: Number(form.radius_meters),
        qr_refresh_seconds: Number(form.qr_refresh_seconds),
        expected_count: Number(form.expected_count),
        photo_retention_days: Number(form.photo_retention_days),
      };
      if (editingSession) {
        await apiFetch(`/api/attendance/sessions/${editingSession.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToastMsg('Đã cập nhật cấu hình phiên điểm danh.');
      } else {
        const res = await apiFetch<{ session: AttendanceSession }>('/api/attendance/sessions', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSelectedId(res.session.id);
        showToastMsg('Đã tạo phiên điểm danh mới.');
      }
      setShowModal(false);
      await loadSessions();
      if (selectedId) await loadDashboard(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu phiên điểm danh.');
    }
  }

  async function handleStatusChange(status: AttendanceSession['status']) {
    if (!dash) return;
    setError('');
    try {
      await apiFetch(`/api/attendance/sessions/${dash.session.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadSessions();
      await loadDashboard(dash.session.id);
      if (status === 'active') await fetchLiveQr(dash.session.id);
      showToastMsg(`Đã chuyển trạng thái phiên sang "${SESSION_STATUS_META[status].label}".`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đổi trạng thái phiên.');
    }
  }

  async function handleManualRefreshQr() {
    if (!dash) return;
    try {
      await apiFetch(`/api/attendance/sessions/${dash.session.id}/refresh-qr`, { method: 'POST' });
      await fetchLiveQr(dash.session.id);
      showToastMsg('Đã làm mới mã QR và vô hiệu hóa mã QR cũ.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể làm mới mã QR.');
    }
  }

  async function handleReviewRecord(recordId: number, status: 'valid' | 'rejected') {
    if (!dash) return;
    try {
      await apiFetch(`/api/attendance/records/${recordId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadDashboard(dash.session.id);
      showToastMsg(status === 'valid' ? 'Đã duyệt lượt điểm danh hợp lệ.' : 'Đã từ chối lượt điểm danh.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật xác minh.');
    }
  }

  async function handlePurgePhotos() {
    if (!dash || !window.confirm('Xóa toàn bộ ảnh xác minh của phiên này khỏi máy chủ theo chính sách bảo vệ dữ liệu cá nhân?')) return;
    try {
      const res = await apiFetch<{ removed: number }>(`/api/attendance/sessions/${dash.session.id}/purge-photos`, {
        method: 'POST',
      });
      await loadDashboard(dash.session.id);
      showToastMsg(`Đã xóa ${res.removed} ảnh xác minh.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa ảnh.');
    }
  }

  async function handleDeleteSession(s: AttendanceSession) {
    if (!window.confirm(`Xóa phiên điểm danh "${s.title}" và toàn bộ dữ liệu điểm danh liên quan?`)) return;
    try {
      await apiFetch(`/api/attendance/sessions/${s.id}`, { method: 'DELETE' });
      await loadSessions();
      showToastMsg('Đã xóa phiên điểm danh.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa phiên.');
    }
  }

  const filteredRecords = (dash?.records ?? []).filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        r.confirmation_code.toLowerCase().includes(q) ||
        (r.participant_name || '').toLowerCase().includes(q) ||
        (r.unit_name || '').toLowerCase().includes(q) ||
        r.device_summary.toLowerCase().includes(q) ||
        r.participant_note.toLowerCase().includes(q) ||
        r.exception_reason.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Top Bar: Session List & Create Button */}
      <div className="card-surface p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[#005baa] dark:text-sky-400">
            Module Điểm danh Hoạt động bằng Mã QR động
          </div>
          <h1 className="text-xl font-bold mt-0.5">Điều hành Phiên điểm danh – Tuổi trẻ Tân Nhựt</h1>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            Kết hợp QR động có chữ ký thời hạn, xác thực GPS tại địa điểm, chụp ảnh tại chỗ và chống trùng lặp phía máy chủ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/diem-danh"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-semibold hover:bg-[var(--bg-subtle)]"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Trang điểm danh Mobile
          </a>
          <button
            type="button"
            onClick={openNewModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#005baa] hover:bg-[#004a8c] text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Tạo phiên điểm danh
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
      )}
      {toast && (
        <div role="status" className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Session Selector Pills */}
      {sessions.length > 0 && (
        <div className="card-surface p-3 flex items-center gap-2 overflow-x-auto">
          {sessions.map((s) => {
            const active = s.id === selectedId;
            const meta = SESSION_STATUS_META[s.status];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedId(s.id)}
                className={`px-3.5 py-2 rounded-xl border text-left transition shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#005baa] text-white border-[#005baa]'
                    : 'bg-[var(--bg-surface)] border-[var(--border-subtle)] hover:bg-[var(--bg-subtle)]'
                }`}
              >
                <div className="text-xs font-bold truncate max-w-[220px]">{s.title}</div>
                <div className={`text-[11px] mt-0.5 flex items-center gap-1.5 ${active ? 'text-sky-100' : 'text-[var(--text-secondary)]'}`}>
                  <span>{s.event_date}</span>
                  <span>•</span>
                  <span>{meta.label}</span>
                  <span>•</span>
                  <span>{s.valid_count ?? 0} lượt</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!dash ? (
        <div className="card-surface p-10 text-center space-y-3">
          <QrCode className="w-12 h-12 mx-auto text-[#005baa]" />
          <div className="text-base font-bold">Chưa có phiên điểm danh QR động nào</div>
          <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto">
            Nhấn <strong>"Tạo phiên điểm danh"</strong> để thiết lập hoạt động, tọa độ GPS, bán kính cho phép (50–100m) và chu kỳ đổi mã QR động (15–30s).
          </p>
        </div>
      ) : (
        <>
          {/* Active Session Control & Live QR Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Session Info + Controls + 5 KPI Cards */}
            <div className="lg:col-span-7 space-y-4">
              <div className="card-surface p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-[#005baa] dark:text-sky-300 font-mono text-xs font-bold">
                        {dash.session.code}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full border text-xs font-semibold ${SESSION_STATUS_META[dash.session.status].cls}`}>
                        {SESSION_STATUS_META[dash.session.status].label}
                      </span>
                      {dash.session.require_photo && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-200 text-[11px] font-semibold">
                          <Camera className="w-3 h-3" /> Bắt buộc ảnh tại chỗ
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-bold">{dash.session.title}</h2>
                    {dash.session.description && (
                      <p className="text-xs text-[var(--text-secondary)]">{dash.session.description}</p>
                    )}
                    <div className="text-xs text-[var(--text-secondary)] flex flex-wrap gap-x-4 gap-y-1 pt-1">
                      <span>Ngày: <strong>{dash.session.event_date}</strong> ({dash.session.start_time} – {dash.session.end_time})</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#005baa]" />
                        {dash.session.location_name} (<strong>{dash.session.radius_meters}m</strong>)
                      </span>
                      <span>Đổi QR: <strong>{dash.session.qr_refresh_seconds}s</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEditModal(dash.session)}
                      className="p-2 rounded-lg hover:bg-[var(--bg-subtle)] text-[#005baa] cursor-pointer"
                      title="Chỉnh sửa cấu hình phiên"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(dash.session)}
                      className="p-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/50 text-red-600 cursor-pointer"
                      title="Xóa phiên"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Session Lifecycle Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border-subtle)]">
                  {dash.session.status !== 'active' && (
                    <button
                      type="button"
                      onClick={() => handleStatusChange('active')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      {dash.session.status === 'paused' ? 'Tiếp tục phiên' : 'Mở phiên điểm danh'}
                    </button>
                  )}
                  {dash.session.status === 'active' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleStatusChange('paused')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold cursor-pointer"
                      >
                        <Pause className="w-3.5 h-3.5" /> Tạm dừng
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStatusChange('closed')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        <Square className="w-3.5 h-3.5" /> Đóng phiên
                      </button>
                      <button
                        type="button"
                        onClick={handleManualRefreshQr}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#005baa] text-[#005baa] dark:text-sky-400 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Làm mới QR
                      </button>
                    </>
                  )}
                  <a
                    href={`/api/attendance/sessions/${dash.session.id}/export/excel`}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-semibold"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Xuất Excel
                  </a>
                  {dash.session.require_photo && (
                    <button
                      type="button"
                      onClick={handlePurgePhotos}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                    >
                      Xóa ảnh ({dash.session.photo_retention_days} ngày)
                    </button>
                  )}
                </div>
              </div>

              {/* 5 Real-time Stats KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="card-surface p-3.5">
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Tổng lượt</div>
                  <div className="text-2xl font-bold mt-1 text-[#005baa] dark:text-sky-400">{dash.stats.totalCheckins}</div>
                </div>
                <div className="card-surface p-3.5">
                  <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">Hợp lệ</div>
                  <div className="text-2xl font-bold mt-1 text-emerald-600">{dash.stats.validCount}</div>
                </div>
                <div className="card-surface p-3.5">
                  <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">Chờ xác minh</div>
                  <div className="text-2xl font-bold mt-1 text-amber-600">{dash.stats.pendingCount}</div>
                </div>
                <div className="card-surface p-3.5">
                  <div className="text-[11px] font-semibold text-red-700 dark:text-red-400">Bị từ chối</div>
                  <div className="text-2xl font-bold mt-1 text-red-600">{dash.stats.rejectedCount}</div>
                </div>
                <div className="card-surface p-3.5">
                  <div className="text-[11px] font-semibold text-[var(--text-secondary)]">Tỷ lệ tham gia</div>
                  <div className="text-2xl font-bold mt-1">
                    {dash.stats.participationRate !== null ? `${dash.stats.participationRate}%` : '—'}
                  </div>
                </div>
              </div>

              {/* Transparency & Privacy Note */}
              <div className="p-3.5 rounded-xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-900 dark:text-sky-200 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-600" />
                <span>
                  <strong>Cơ chế minh bạch & bảo mật:</strong> Vì hệ thống không yêu cầu đăng nhập hay mã đoàn viên, mã thiết bị và ảnh chụp tại chỗ chỉ mang tính hỗ trợ đối chiếu sự hiện diện (không kết luận gian lận tự động). Các trường hợp dùng chung điện thoại được chuyển sang mục <strong>Chờ xác minh</strong> để cán bộ phụ trách duyệt thủ công.
                </span>
              </div>
            </div>

            {/* Right: Dynamic QR Card + Fullscreen LED Mode */}
            <div className="lg:col-span-5 card-surface p-5 flex flex-col items-center justify-center text-center space-y-3">
              {dash.session.status === 'active' && liveQr ? (
                <>
                  <div className="w-full flex items-center justify-between text-xs">
                    <span className="font-bold text-[#005baa] dark:text-sky-400 flex items-center gap-1.5">
                      <QrCode className="w-4 h-4" /> MÃ QR ĐỘNG ĐANG HOẠT ĐỘNG
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 font-mono font-bold">
                      Đổi sau {countdown}s
                    </span>
                  </div>

                  <div className="p-3 bg-white rounded-2xl border-2 border-[#005baa]/20 shadow-sm">
                    <img src={liveQr.qrDataUrl} alt="Mã QR điểm danh động" className="w-56 h-56 sm:w-64 sm:h-64" />
                  </div>

                  {/* Countdown progress bar */}
                  <div className="w-full max-w-xs h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-[#005baa] transition-all duration-1000"
                      style={{ width: `${Math.min(100, (countdown / liveQr.refreshSeconds) * 100)}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setLedFullscreen(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#005baa] hover:bg-[#004a8c] text-white text-xs font-bold cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4" /> Trình chiếu LED toàn màn hình
                    </button>
                    <a
                      href={liveQr.checkinUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-[var(--border-color)] text-xs font-semibold hover:bg-[var(--bg-subtle)]"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Mở link quét thử
                    </a>
                  </div>
                </>
              ) : (
                <div className="py-10 space-y-3">
                  <QrCode className="w-16 h-16 mx-auto text-slate-300 dark:text-slate-600" />
                  <div className="font-bold text-sm">Mã QR động đang tắt</div>
                  <p className="text-xs text-[var(--text-secondary)] max-w-xs mx-auto">
                    Nhấn <strong>"Mở phiên điểm danh"</strong> để kích hoạt sinh mã QR động tự động đổi mỗi {dash.session.qr_refresh_seconds} giây.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Live Check-in Records & Attempts Log */}
          <div className="card-surface overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="inline-flex p-1 rounded-xl bg-[var(--bg-subtle)]">
                <button
                  type="button"
                  onClick={() => setListTab('records')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    listTab === 'records' ? 'bg-[#005baa] text-white' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Danh sách điểm danh ({dash.records.length})
                </button>
                <button
                  type="button"
                  onClick={() => setListTab('attempts')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    listTab === 'attempts' ? 'bg-[#005baa] text-white' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  Nhật ký xác thực ({dash.attempts.length})
                </button>
              </div>

              {listTab === 'records' && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Tìm mã xác nhận, thiết bị..."
                      className="pl-9 pr-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs w-52"
                    />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    aria-label="Lọc trạng thái lượt điểm danh"
                    className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] text-xs"
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="valid">Hợp lệ</option>
                    <option value="pending_verification">Chờ xác minh</option>
                    <option value="rejected">Từ chối</option>
                  </select>
                </div>
              )}
            </div>

            {listTab === 'records' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] text-xs uppercase">
                      <th className="py-3 px-4">Thời gian & Mã</th>
                      <th className="py-3 px-3">Đoàn viên & Chi đoàn</th>
                      <th className="py-3 px-3">Trạng thái</th>
                      <th className="py-3 px-3">GPS</th>
                      <th className="py-3 px-3">QR</th>
                      <th className="py-3 px-3">Thiết bị</th>
                      <th className="py-3 px-3">Ảnh tại chỗ</th>
                      <th className="py-3 px-3">Ghi chú / Ngoại lệ</th>
                      <th className="py-3 px-4 text-right">Xử lý</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-sm text-[var(--text-secondary)]">
                          Chưa có lượt điểm danh nào.
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((r) => (
                        <tr key={r.id} className="hover:bg-[var(--bg-subtle)]/50">
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-xs text-[#005baa] dark:text-sky-400">
                              {r.confirmation_code}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)]">
                              {formatDateTime(r.checked_in_at)}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-xs">{r.participant_name || '—'}</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">{r.unit_name || '—'}</div>
                          </td>
                          <td className="py-3 px-3">
                            {r.status === 'valid' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 text-xs font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Hợp lệ
                              </span>
                            )}
                            {r.status === 'pending_verification' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 text-xs font-semibold">
                                <Clock className="w-3.5 h-3.5" /> Chờ xác minh
                              </span>
                            )}
                            {r.status === 'rejected' && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 text-xs font-semibold">
                                <XCircle className="w-3.5 h-3.5" /> Từ chối
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs">
                            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                              {r.distance_meters !== null ? `${r.distance_meters}m` : '—'}
                            </span>
                            {r.gps_status === 'suspicious' && (
                              <div className="text-[10px] text-amber-600 font-semibold">Cần kiểm tra GPS</div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            Hợp lệ
                          </td>
                          <td className="py-3 px-3 text-xs text-[var(--text-secondary)]">{r.device_summary}</td>
                          <td className="py-3 px-3">
                            {r.photo_stored_name ? (
                              <button
                                type="button"
                                onClick={() => setPhotoPreviewRecord(r)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950 text-[#005baa] dark:text-sky-300 text-xs font-semibold cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" /> Xem ảnh
                              </button>
                            ) : (
                              <span className="text-xs text-[var(--text-secondary)]">
                                {r.photo_status === 'not_required' ? 'Không yêu cầu' : 'Đã xóa'}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs max-w-xs">
                            {r.participant_note && <div className="font-medium">{r.participant_note}</div>}
                            {r.exception_reason && (
                              <div className="text-amber-700 dark:text-amber-400 text-[11px]">{r.exception_reason}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {r.status !== 'valid' && (
                              <button
                                type="button"
                                onClick={() => handleReviewRecord(r.id, 'valid')}
                                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold mr-1 cursor-pointer"
                              >
                                Duyệt
                              </button>
                            )}
                            {r.status !== 'rejected' && (
                              <button
                                type="button"
                                onClick={() => handleReviewRecord(r.id, 'rejected')}
                                className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950 dark:text-red-300 text-xs font-semibold cursor-pointer"
                              >
                                Từ chối
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-subtle)] text-[var(--text-secondary)] uppercase">
                      <th className="py-2.5 px-4">Thời gian</th>
                      <th className="py-2.5 px-3">Kết quả</th>
                      <th className="py-2.5 px-3">Mã sự kiện</th>
                      <th className="py-2.5 px-3">Khoảng cách GPS</th>
                      <th className="py-2.5 px-3">Thiết bị</th>
                      <th className="py-2.5 px-4">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {dash.attempts.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 px-4 whitespace-nowrap text-[var(--text-secondary)]">
                          {formatDateTime(a.created_at)}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          {a.outcome === 'valid' ? (
                            <span className="text-emerald-600">Hợp lệ</span>
                          ) : a.outcome === 'pending_verification' ? (
                            <span className="text-amber-600">Chờ xác minh</span>
                          ) : (
                            <span className="text-red-600">Bị từ chối</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{a.reject_code || 'OK'}</td>
                        <td className="py-2.5 px-3">{a.distance_meters !== null ? `${a.distance_meters}m` : '—'}</td>
                        <td className="py-2.5 px-3">{a.device_summary}</td>
                        <td className="py-2.5 px-4">{a.reject_reason || 'Điểm danh thành công'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ==================== FULLSCREEN LED QR PRESENTER ==================== */}
      {ledFullscreen && dash && liveQr && (
        <div className="fixed inset-0 z-50 youth-gradient text-white flex flex-col justify-between p-6 sm:p-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs sm:text-sm font-bold uppercase tracking-widest text-amber-300">
                ĐOÀN TNCS HỒ CHÍ MINH XÃ TÂN NHỰT • DASHBOARD TUỔI TRẺ TÂN NHỰT
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold mt-1">{dash.session.title}</h1>
              <div className="text-sky-100 text-sm sm:text-base mt-1 flex flex-wrap gap-x-6 gap-y-1">
                <span>Địa điểm: <strong>{dash.session.location_name}</strong> (Bán kính {dash.session.radius_meters}m)</span>
                <span>Đã điểm danh hợp lệ: <strong className="text-amber-300">{dash.stats.validCount}</strong> lượt</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLedFullscreen(false)}
              className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white cursor-pointer"
              aria-label="Thoát chế độ toàn màn hình"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          <div className="flex flex-col items-center justify-center my-auto space-y-5">
            <div className="p-5 sm:p-6 bg-white rounded-3xl shadow-2xl">
              <img src={liveQr.qrDataUrl} alt="QR điểm danh LED" className="w-72 h-72 sm:w-96 sm:h-96" />
            </div>

            <div className="w-full max-w-md space-y-2 text-center">
              <div className="text-xl sm:text-2xl font-extrabold">
                QUÉT MÃ QR BẰNG ĐIỆN THOẠI ĐỂ ĐIỂM DANH
              </div>
              <div className="text-sm sm:text-base text-sky-100">
                Mã QR tự động thay đổi sau <strong className="text-amber-300 text-xl font-mono">{countdown} giây</strong> • Không chụp ảnh gửi đi xa
              </div>
              <div className="w-full h-2.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-all duration-1000"
                  style={{ width: `${Math.min(100, (countdown / liveQr.refreshSeconds) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="text-center text-xs sm:text-sm text-sky-100/80">
            Không cần đăng nhập • Không cần nhập mã đoàn viên • Bật GPS tại địa điểm tổ chức để xác thực
          </div>
        </div>
      )}

      {/* ==================== MODAL: CREATE / EDIT SESSION ==================== */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <form onSubmit={handleSaveSession} className="card-surface max-w-xl w-full p-6 space-y-4 my-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">
                {editingSession ? 'Chỉnh sửa phiên điểm danh' : 'Tạo phiên điểm danh QR động mới'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block font-medium mb-1">Tên hoạt động *</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="VD: Lễ ra quân Ngày Chủ nhật xanh lần thứ 155"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Nội dung hoạt động</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Ngày tổ chức *</label>
                  <input
                    type="date"
                    required
                    value={form.event_date}
                    onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Giờ bắt đầu *</label>
                  <input
                    type="time"
                    required
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Giờ kết thúc *</label>
                  <input
                    type="time"
                    required
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1">Địa điểm tổ chức *</label>
                <input
                  required
                  value={form.location_name}
                  onChange={(e) => setForm({ ...form, location_name: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block font-medium mb-1">Vĩ độ (Latitude) *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Kinh độ (Longitude) *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <button
                  type="button"
                  onClick={fillCurrentGps}
                  className="py-2 px-3 rounded-lg border border-[#005baa] text-[#005baa] dark:text-sky-400 text-xs font-semibold flex items-center justify-center gap-1 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5" /> Lấy GPS hiện tại
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium mb-1">Bán kính (mét)</label>
                  <input
                    type="number"
                    min={15}
                    max={2000}
                    value={form.radius_meters}
                    onChange={(e) => setForm({ ...form, radius_meters: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Đổi QR (giây)</label>
                  <input
                    type="number"
                    min={10}
                    max={120}
                    value={form.qr_refresh_seconds}
                    onChange={(e) => setForm({ ...form, qr_refresh_seconds: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Dự kiến (người)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.expected_count}
                    onChange={(e) => setForm({ ...form, expected_count: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)]"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={form.require_photo}
                  onChange={(e) => setForm({ ...form, require_photo: e.target.checked })}
                />
                Bật xác minh ảnh chụp trực tiếp tại chỗ (chỉ cho phép mở camera, không chọn ảnh từ thư viện)
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-sm cursor-pointer">Hủy</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#005baa] text-white text-sm font-semibold cursor-pointer">
                {editingSession ? 'Lưu thay đổi' : 'Tạo phiên điểm danh'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL: PHOTO VERIFICATION PREVIEW ==================== */}
      {photoPreviewRecord && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPhotoPreviewRecord(null)}
        >
          <div className="card-surface max-w-lg w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-sm">Ảnh xác minh tại chỗ · {photoPreviewRecord.confirmation_code}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {formatDateTime(photoPreviewRecord.checked_in_at)} • Khoảng cách GPS: {photoPreviewRecord.distance_meters}m
                </div>
              </div>
              <button type="button" onClick={() => setPhotoPreviewRecord(null)} className="p-1 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={`/api/attendance/photos/${photoPreviewRecord.id}`}
              alt="Ảnh xác minh điểm danh"
              className="w-full max-h-[60vh] object-contain rounded-xl bg-slate-100 dark:bg-slate-900"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  await handleReviewRecord(photoPreviewRecord.id, 'rejected');
                  setPhotoPreviewRecord(null);
                }}
                className="px-3.5 py-2 rounded-lg bg-red-100 text-red-700 text-xs font-semibold cursor-pointer"
              >
                Từ chối
              </button>
              <button
                type="button"
                onClick={async () => {
                  await handleReviewRecord(photoPreviewRecord.id, 'valid');
                  setPhotoPreviewRecord(null);
                }}
                className="px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Xác nhận hợp lệ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
