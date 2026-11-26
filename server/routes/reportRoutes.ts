import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { getDb } from '../db/client.js';
import { requireAuth, requireRoles } from '../auth.js';
import { getVersionPointSummary } from '../scoring.js';

export const reportRouter = Router();

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Chưa đánh giá',
  self_assessing: 'Đang tự đánh giá',
  submitted: 'Đã gửi hồ sơ',
  under_review: 'Đang đánh giá',
  needs_revision: 'Cần bổ sung',
  completed: 'Đã hoàn tất',
};

function findUnicodeFont(bold = false): string | null {
  const candidates = bold
    ? [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/Library/Fonts/Arial Unicode.ttf',
      ]
    : [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
        '/Library/Fonts/Arial Unicode.ttf',
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function fetchReportData(versionId: number, unitFilterId?: number) {
  const db = await getDb();
  const vRes = await db.query<{
    id: number;
    code: string;
    title: string;
    year: number;
    period: string;
    supplementary_published: boolean;
  }>('SELECT * FROM scorecard_versions WHERE id = $1', [versionId]);
  const version = vRes.rows[0];
  if (!version) return null;

  const points = await getVersionPointSummary(db, versionId);
  const critCountRes = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM criteria_items
     WHERE version_id = $1 AND (section_type = 'fixed' OR $2 = TRUE)`,
    [versionId, points.supplementaryPublished],
  );
  const totalActiveCriteria = Number(critCountRes.rows[0]?.cnt ?? 0);

  const rowsRes = await db.query<{
    evaluation_id: number;
    unit_id: number;
    unit_code: string;
    unit_name: string;
    secretary_name: string;
    status: string;
    self_total: string;
    review_total: string | null;
    official_total: string | null;
    active_max_score: string;
    classification: string;
    submitted_at: string | null;
    confirmed_at: string | null;
    self_filled: string;
    review_filled: string;
  }>(
    `SELECT e.id AS evaluation_id, e.unit_id, u.code AS unit_code, u.name AS unit_name,
            u.secretary_name, e.status,
            e.self_total::text, e.review_total::text, e.official_total::text,
            e.active_max_score::text, e.classification, e.submitted_at, e.confirmed_at,
            (SELECT COUNT(*)::text FROM evaluation_scores es
             JOIN criteria_items ci ON ci.id = es.criterion_id
             WHERE es.evaluation_id = e.id AND es.self_score IS NOT NULL
               AND (ci.section_type = 'fixed' OR $2 = TRUE)) AS self_filled,
            (SELECT COUNT(*)::text FROM evaluation_scores es
             JOIN criteria_items ci ON ci.id = es.criterion_id
             WHERE es.evaluation_id = e.id AND es.review_score IS NOT NULL
               AND (ci.section_type = 'fixed' OR $2 = TRUE)) AS review_filled
     FROM evaluations e
     JOIN units u ON u.id = e.unit_id
     WHERE e.version_id = $1
     ORDER BY COALESCE(e.official_total, -1) DESC, COALESCE(e.review_total, -1) DESC, e.self_total DESC, u.code ASC`,
    [versionId, points.supplementaryPublished],
  );

  let rank = 1;
  const allRankedRows = rowsRes.rows.map((r) => {
    const selfTotal = Number(r.self_total ?? 0);
    const reviewTotal = r.review_total !== null ? Number(r.review_total) : null;
    const officialTotal = r.official_total !== null ? Number(r.official_total) : null;
    const diff = reviewTotal !== null ? Number((reviewTotal - selfTotal).toFixed(2)) : null;
    const activeMax = Number(r.active_max_score ?? points.activeMaxScore);
    const completionPct = totalActiveCriteria > 0
      ? Math.round((Number(r.self_filled) / totalActiveCriteria) * 100)
      : 0;
    const assignedRank = officialTotal !== null ? rank++ : null;

    return {
      rank: assignedRank,
      evaluation_id: r.evaluation_id,
      unit_id: r.unit_id,
      unit_code: r.unit_code,
      unit_name: r.unit_name,
      secretary_name: r.secretary_name,
      status: r.status,
      status_label: STATUS_LABELS[r.status] ?? r.status,
      self_total: selfTotal,
      review_total: reviewTotal,
      diff,
      official_total: officialTotal,
      active_max_score: activeMax,
      completion_pct: completionPct,
      classification: r.classification,
      submitted_at: r.submitted_at,
      confirmed_at: r.confirmed_at,
    };
  });

  // Strictly filter output rows to the requested unit (enforced for unit role) while preserving true rank
  const rows = unitFilterId
    ? allRankedRows.filter((r) => r.unit_id === unitFilterId)
    : allRankedRows;

  return { version, points, totalActiveCriteria, rows };
}

reportRouter.get('/summary', requireAuth, async (req, res) => {
  try {
    const db = await getDb();
    let versionId = req.query.versionId ? Number(req.query.versionId) : null;
    if (!versionId) {
      const def = await db.query<{ id: number }>(
        `SELECT id FROM scorecard_versions ORDER BY CASE status WHEN 'published' THEN 1 ELSE 2 END, year DESC LIMIT 1`,
      );
      versionId = def.rows[0]?.id ?? null;
    }
    if (!versionId) {
      res.json({ version: null, rows: [] });
      return;
    }

    const unitFilterId = req.user!.role === 'unit'
      ? req.user!.unit_id ?? undefined
      : req.query.unitId
        ? Number(req.query.unitId)
        : undefined;

    const data = await fetchReportData(versionId, unitFilterId);
    if (!data) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm.' });
      return;
    }

    res.json(data);
  } catch (err) {
    console.error('Report summary error:', err);
    res.status(500).json({ error: 'Không thể tải báo cáo tổng hợp.' });
  }
});

// Export Excel (.xlsx)
reportRouter.get('/export/excel', requireAuth, async (req, res) => {
  try {
    const versionId = Number(req.query.versionId);
    if (!versionId) {
      res.status(400).json({ error: 'Thiếu mã phiên bản bảng điểm.' });
      return;
    }

    const unitFilterId = req.user!.role === 'unit'
      ? req.user!.unit_id ?? undefined
      : req.query.unitId
        ? Number(req.query.unitId)
        : undefined;

    const data = await fetchReportData(versionId, unitFilterId);
    if (!data) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm.' });
      return;
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Dashboard Tuổi trẻ Tân Nhựt';
    wb.created = new Date();

    const ws = wb.addWorksheet('Tổng hợp Đánh giá');
    ws.mergeCells('A1:J1');
    ws.getCell('A1').value = 'ĐOÀN TNCS HỒ CHÍ MINH XÃ TÂN NHỰT – DASHBOARD TUỔI TRẺ TÂN NHỰT';
    ws.getCell('A1').font = { bold: true, size: 13, color: { argb: 'FF005BAA' } };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    ws.mergeCells('A2:J2');
    ws.getCell('A2').value = `BÁO CÁO TỔNG HỢP ĐÁNH GIÁ, XẾP LOẠI CƠ SỞ ĐOÀN – ${data.version.title.toUpperCase()}`;
    ws.getCell('A2').font = { bold: true, size: 12 };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    ws.mergeCells('A3:J3');
    ws.getCell('A3').value = `Thang điểm đang áp dụng: ${data.points.activeMaxScore}/100 điểm (Cố định: ${data.points.fixedMax}/60; Bổ sung: ${data.points.supplementaryPublished ? `${data.points.supplementaryConfiguredMax}/40 đã công bố` : 'Chưa công bố – không tính 0 điểm'})`;
    ws.getCell('A3').font = { italic: true, size: 10, color: { argb: 'FF475569' } };
    ws.getCell('A3').alignment = { horizontal: 'center' };

    ws.addRow([]);

    const headerRow = ws.addRow([
      'Hạng',
      'Mã đơn vị',
      'Tên Cơ sở Đoàn',
      'Bí thư Chi đoàn',
      'Trạng thái',
      'Tiến độ (%)',
      'Điểm tự chấm',
      'Điểm Đoàn xã chấm',
      'Chênh lệch',
      'Xếp loại chính thức',
    ]);

    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF005BAA' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });
    headerRow.height = 28;

    for (const r of data.rows) {
      const row = ws.addRow([
        r.rank ?? '—',
        r.unit_code,
        r.unit_name,
        r.secretary_name,
        r.status_label,
        `${r.completion_pct}%`,
        r.self_total,
        r.review_total ?? '—',
        r.diff !== null ? (r.diff > 0 ? `+${r.diff}` : r.diff) : '—',
        r.classification,
      ]);
      row.eachCell((cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
          right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
        if ([1, 2, 5, 6, 7, 8, 9].includes(colNumber)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    }

    ws.columns = [
      { width: 8 },
      { width: 14 },
      { width: 32 },
      { width: 22 },
      { width: 18 },
      { width: 13 },
      { width: 15 },
      { width: 16 },
      { width: 13 },
      { width: 24 },
    ];

    const filename = `Bao-cao-danh-gia-Co-so-Doan-${data.version.year}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).json({ error: 'Không thể xuất báo cáo Excel.' });
  }
});

// Export PDF (.pdf)
reportRouter.get('/export/pdf', requireAuth, async (req, res) => {
  try {
    const versionId = Number(req.query.versionId);
    if (!versionId) {
      res.status(400).json({ error: 'Thiếu mã phiên bản bảng điểm.' });
      return;
    }

    const unitFilterId = req.user!.role === 'unit'
      ? req.user!.unit_id ?? undefined
      : req.query.unitId
        ? Number(req.query.unitId)
        : undefined;

    const data = await fetchReportData(versionId, unitFilterId);
    if (!data) {
      res.status(404).json({ error: 'Không tìm thấy phiên bản bảng điểm.' });
      return;
    }

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const filename = `Bao-cao-danh-gia-Co-so-Doan-${data.version.year}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    doc.pipe(res);

    const regularFont = findUnicodeFont(false);
    const boldFont = findUnicodeFont(true);
    if (regularFont) doc.registerFont('VN-Regular', regularFont);
    if (boldFont) doc.registerFont('VN-Bold', boldFont);

    const fReg = regularFont ? 'VN-Regular' : 'Helvetica';
    const fBold = boldFont ? 'VN-Bold' : 'Helvetica-Bold';

    doc.font(fBold).fontSize(13).fillColor('#005baa')
      .text('ĐOÀN TNCS HỒ CHÍ MINH XÃ TÂN NHỰT – DASHBOARD TUỔI TRẺ TÂN NHỰT', { align: 'center' });
    doc.moveDown(0.3);
    doc.font(fBold).fontSize(12).fillColor('#0f172a')
      .text(`BÁO CÁO TỔNG HỢP ĐÁNH GIÁ, XẾP LOẠI CƠ SỞ ĐOÀN (${data.version.year})`, { align: 'center' });
    doc.moveDown(0.2);
    doc.font(fReg).fontSize(9.5).fillColor('#475569')
      .text(
        `${data.version.title} | Thang điểm áp dụng: ${data.points.activeMaxScore}/100 (Cố định: ${data.points.fixedMax}/60; Bổ sung: ${data.points.supplementaryPublished ? `${data.points.supplementaryConfiguredMax}/40` : 'Chưa công bố'})`,
        { align: 'center' },
      );
    doc.moveDown(1);

    // Table headers
    const cols = [
      { label: 'Hạng', x: 36, w: 38 },
      { label: 'Mã ĐV', x: 74, w: 62 },
      { label: 'Tên Cơ sở Đoàn', x: 136, w: 185 },
      { label: 'Trạng thái', x: 321, w: 92 },
      { label: 'Tự chấm', x: 413, w: 62 },
      { label: 'Đoàn xã chấm', x: 475, w: 68 },
      { label: 'Chênh lệch', x: 543, w: 65 },
      { label: 'Chính thức', x: 608, w: 66 },
      { label: 'Xếp loại', x: 674, w: 130 },
    ];

    let y = doc.y;
    doc.rect(36, y, 768, 24).fill('#005baa');
    doc.font(fBold).fontSize(9).fillColor('#ffffff');
    for (const c of cols) {
      doc.text(c.label, c.x + 4, y + 7, { width: c.w - 8, align: c.w < 80 ? 'center' : 'left' });
    }
    y += 24;

    doc.font(fReg).fontSize(9);
    for (let i = 0; i < data.rows.length; i++) {
      const r = data.rows[i];
      if (y > 530) {
        doc.addPage();
        y = 40;
      }
      if (i % 2 === 1) {
        doc.rect(36, y, 768, 22).fill('#f8fafc');
      }
      doc.fillColor('#0f172a');
      const vals = [
        r.rank ? String(r.rank) : '—',
        r.unit_code,
        r.unit_name,
        r.status_label,
        String(r.self_total),
        r.review_total !== null ? String(r.review_total) : '—',
        r.diff !== null ? (r.diff > 0 ? `+${r.diff}` : String(r.diff)) : '—',
        r.official_total !== null ? `${r.official_total}/${r.active_max_score}` : '—',
        r.classification,
      ];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        doc.text(vals[ci], c.x + 4, y + 6, { width: c.w - 8, align: c.w < 80 ? 'center' : 'left' });
      }
      doc.moveTo(36, y + 22).lineTo(804, y + 22).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
      y += 22;
    }

    doc.moveDown(1.5);
    doc.font(fReg).fontSize(8.5).fillColor('#64748b')
      .text(`Xuất tự động từ Phân hệ Đánh giá Cơ sở Đoàn – Dashboard Tuổi trẻ Tân Nhựt lúc ${new Date().toLocaleString('vi-VN')}`, 36, y + 12);

    doc.end();
  } catch (err) {
    console.error('Export PDF error:', err);
    res.status(500).json({ error: 'Không thể xuất báo cáo PDF.' });
  }
});

// Audit Logs (Admin & Reviewer)
reportRouter.get('/audit-logs', requireAuth, requireRoles('admin', 'reviewer'), async (req, res) => {
  try {
    const db = await getDb();
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 100));
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const action = String(req.query.action ?? '').trim();

    const params: unknown[] = [];
    const conditions: string[] = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(LOWER(summary) LIKE $${params.length} OR LOWER(actor_name) LIKE $${params.length} OR LOWER(action) LIKE $${params.length})`);
    }
    if (action) {
      params.push(action);
      conditions.push(`action = $${params.length}`);
    }
    params.push(limit);
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const logsRes = await db.query(
      `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );

    res.json({ logs: logsRes.rows });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Không thể tải nhật ký hoạt động.' });
  }
});
