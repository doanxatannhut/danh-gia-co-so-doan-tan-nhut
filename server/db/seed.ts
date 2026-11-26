import type { DbClient } from './client.js';
import { hashPassword } from '../auth.js';
import { recalculateEvaluationTotals } from '../scoring.js';

export async function seedIfEmpty(db: DbClient): Promise<void> {
  const existing = await db.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
  if (Number(existing.rows[0]?.count ?? 0) > 0) return;

  // 1. Seed 8 Cơ sở Đoàn trực thuộc Đoàn xã Tân Nhựt
  const unitsData = [
    { code: 'CD-AP1', name: 'Chi đoàn Ấp 1', unit_type: 'dia_ban_dan_cu', secretary_name: 'Nguyễn Minh Quân', phone: '0908111001', member_count: 42 },
    { code: 'CD-AP2', name: 'Chi đoàn Ấp 2', unit_type: 'dia_ban_dan_cu', secretary_name: 'Trần Thị Ngọc Hân', phone: '0908111002', member_count: 38 },
    { code: 'CD-AP3', name: 'Chi đoàn Ấp 3', unit_type: 'dia_ban_dan_cu', secretary_name: 'Lê Hoàng Phúc', phone: '0908111003', member_count: 35 },
    { code: 'CD-AP4', name: 'Chi đoàn Ấp 4', unit_type: 'dia_ban_dan_cu', secretary_name: 'Phạm Quốc Bảo', phone: '0908111004', member_count: 40 },
    { code: 'CD-THCS', name: 'Chi đoàn Trường THCS Tân Nhựt', unit_type: 'truong_hoc', secretary_name: 'Võ Thị Thanh Trúc', phone: '0908111005', member_count: 28 },
    { code: 'CD-TH', name: 'Chi đoàn Trường Tiểu học Tân Nhựt', unit_type: 'truong_hoc', secretary_name: 'Huỳnh Gia Huy', phone: '0908111006', member_count: 24 },
    { code: 'CD-CQ', name: 'Chi đoàn Cơ quan UBND xã Tân Nhựt', unit_type: 'co_quan', secretary_name: 'Đặng Tuấn Kiệt', phone: '0908111007', member_count: 19 },
    { code: 'CD-CAQS', name: 'Chi đoàn Công an – Quân sự xã', unit_type: 'luc_luong_vu_trang', secretary_name: 'Bùi Văn Thành', phone: '0908111008', member_count: 22 },
  ];

  const unitIds: Record<string, number> = {};
  for (const u of unitsData) {
    const res = await db.query<{ id: number }>(
      `INSERT INTO units (code, name, unit_type, secretary_name, phone, member_count)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.code, u.name, u.unit_type, u.secretary_name, u.phone, u.member_count],
    );
    unitIds[u.code] = res.rows[0].id;
  }

  // 2. Seed Users (Admin, Reviewer, Unit accounts)
  const adminPass = hashPassword('admin123');
  const reviewerPass = hashPassword('thamdinh123');
  const unitPass = hashPassword('doan123');

  const adminRes = await db.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, full_name, role, unit_id, title)
     VALUES ('admin', $1, 'Nguyễn Văn An', 'admin', NULL, 'Bí thư Đoàn xã Tân Nhựt') RETURNING id`,
    [adminPass],
  );
  const adminId = adminRes.rows[0].id;

  const reviewerRes = await db.query<{ id: number }>(
    `INSERT INTO users (username, password_hash, full_name, role, unit_id, title)
     VALUES ('thamdinh', $1, 'Trần Thị Bích Thảo', 'reviewer', NULL, 'Phó Bí thư Đoàn xã – Tổ trưởng Tổ thẩm định') RETURNING id`,
    [reviewerPass],
  );
  const reviewerId = reviewerRes.rows[0].id;

  const unitUserMap: Record<string, number> = {};
  const unitAccounts = [
    { username: 'cd_ap1', full_name: 'Nguyễn Minh Quân', code: 'CD-AP1', title: 'Bí thư Chi đoàn Ấp 1' },
    { username: 'cd_ap2', full_name: 'Trần Thị Ngọc Hân', code: 'CD-AP2', title: 'Bí thư Chi đoàn Ấp 2' },
    { username: 'cd_ap3', full_name: 'Lê Hoàng Phúc', code: 'CD-AP3', title: 'Bí thư Chi đoàn Ấp 3' },
    { username: 'cd_ap4', full_name: 'Phạm Quốc Bảo', code: 'CD-AP4', title: 'Bí thư Chi đoàn Ấp 4' },
    { username: 'cd_thcs', full_name: 'Võ Thị Thanh Trúc', code: 'CD-THCS', title: 'Bí thư Chi đoàn Trường THCS Tân Nhựt' },
    { username: 'cd_th', full_name: 'Huỳnh Gia Huy', code: 'CD-TH', title: 'Bí thư Chi đoàn Trường Tiểu học Tân Nhựt' },
    { username: 'cd_cq', full_name: 'Đặng Tuấn Kiệt', code: 'CD-CQ', title: 'Bí thư Chi đoàn Cơ quan UBND xã' },
    { username: 'cd_caqs', full_name: 'Bùi Văn Thành', code: 'CD-CAQS', title: 'Bí thư Chi đoàn Công an – Quân sự xã' },
  ];

  for (const ua of unitAccounts) {
    const res = await db.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, full_name, role, unit_id, title)
       VALUES ($1, $2, $3, 'unit', $4, $5) RETURNING id`,
      [ua.username, unitPass, ua.full_name, unitIds[ua.code], ua.title],
    );
    unitUserMap[ua.code] = res.rows[0].id;
  }

  // 3. Seed Scorecard Version 2026 (Published, 60 fixed pts configured, 40 supplementary pts empty & unpublished)
  const v2026Res = await db.query<{ id: number }>(
    `INSERT INTO scorecard_versions
      (code, title, year, period, version_number, status, fixed_max_cap, supplementary_max_cap, supplementary_published, published_at, created_by)
     VALUES
      ('BD-2026-V1', 'Bảng điểm đánh giá Cơ sở Đoàn năm 2026 – Đợt tổng kết năm', 2026, 'Đợt tổng kết năm 2026', 1, 'published', 60, 40, FALSE, NOW() - INTERVAL '14 days', $1)
     RETURNING id`,
    [adminId],
  );
  const v2026Id = v2026Res.rows[0].id;

  // Fixed 60 points structure (4 groups = 15 + 15 + 15 + 15 = 60 points)
  const fixedGroups = [
    {
      code: 'I',
      title: 'Công tác tuyên truyền, giáo dục chính trị tư tưởng',
      description: 'Đánh giá việc học tập nghị quyết, sinh hoạt chuyên đề, giáo dục truyền thống và đấu tranh bảo vệ nền tảng tư tưởng.',
      max_score: 15,
      items: [
        {
          code: 'TC-1.1',
          title: 'Tổ chức học tập, quán triệt Nghị quyết Đại hội Đoàn và các chuyên đề học tập làm theo tư tưởng, đạo đức, phong cách Hồ Chí Minh',
          scoring_guide: 'Đạt 5 điểm khi tổ chức đủ >= 2 đợt/năm và >= 90% đoàn viên tham gia; 3 điểm nếu đạt 70–89%; 0–2 điểm nếu dưới 70%.',
          evidence_requirement: 'Biên bản sinh hoạt, danh sách điểm danh đoàn viên, hình ảnh tổ chức.',
          max_score: 5,
        },
        {
          code: 'TC-1.2',
          title: 'Triển khai tuyên truyền trên không gian mạng, chia sẻ tin tốt câu chuyện đẹp trên kênh Tuổi trẻ Tân Nhựt',
          scoring_guide: 'Đạt 5 điểm khi duy trì >= 2 bài viết/tháng có tương tác tích cực và chia sẻ đầy đủ tuyến bài của Đoàn xã.',
          evidence_requirement: 'Ảnh chụp màn hình bài đăng, bảng tổng hợp đường link tuyên truyền.',
          max_score: 5,
        },
        {
          code: 'TC-1.3',
          title: 'Tổ chức hoạt động về nguồn, đền ơn đáp nghĩa, giáo dục truyền thống địa phương xã Tân Nhựt',
          scoring_guide: 'Đạt 5 điểm khi tổ chức >= 2 hoạt động về nguồn/đền ơn đáp nghĩa trong năm; 3 điểm nếu 1 hoạt động.',
          evidence_requirement: 'Kế hoạch, hình ảnh thực tế, báo cáo kết quả hoạt động.',
          max_score: 5,
        },
      ],
    },
    {
      code: 'II',
      title: 'Tổ chức các phong trào hành động cách mạng và tình nguyện',
      description: 'Đánh giá hiệu quả triển khai Thanh niên tình nguyện, Tuổi trẻ sáng tạo, Chuyển đổi số và xây dựng nông thôn mới.',
      max_score: 15,
      items: [
        {
          code: 'TC-2.1',
          title: 'Thực hiện công trình, phần việc thanh niên gắn với xây dựng nông thôn mới nâng cao và bảo vệ môi trường',
          scoring_guide: 'Đạt 6 điểm khi hoàn thành >= 1 công trình thanh niên cấp Chi đoàn có giá trị thiết thực, được Đoàn xã công nhận.',
          evidence_requirement: 'Hồ sơ công trình thanh niên, hình ảnh trước – sau thực hiện.',
          max_score: 6,
        },
        {
          code: 'TC-2.2',
          title: 'Tham gia đội hình tình nguyện, Ngày Chủ nhật xanh, hỗ trợ chuyển đổi số cộng đồng tại địa bàn',
          scoring_guide: 'Đạt 5 điểm khi tham gia đầy đủ >= 4 đợt ra quân trong năm với >= 80% lực lượng đăng ký.',
          evidence_requirement: 'Danh sách lực lượng tham gia, hình ảnh hoạt động có đóng dấu thời gian.',
          max_score: 5,
        },
        {
          code: 'TC-2.3',
          title: 'Đề xuất ý tưởng, sáng kiến cải tiến trên Cổng Ngân hàng ý tưởng sáng tạo thanh niên',
          scoring_guide: 'Đạt 4 điểm khi đạt chỉ tiêu >= 5 ý tưởng được cập nhật hợp lệ trên hệ thống.',
          evidence_requirement: 'Bảng xuất danh sách ý tưởng hoặc ảnh chụp xác nhận trên hệ thống.',
          max_score: 4,
        },
      ],
    },
    {
      code: 'III',
      title: 'Công tác xây dựng tổ chức Đoàn, quản lý đoàn viên',
      description: 'Đánh giá nề nếp sinh hoạt chi đoàn, quản lý đoàn viên trên phần mềm, phát triển đoàn viên mới và giới thiệu đoàn viên ưu tú.',
      max_score: 15,
      items: [
        {
          code: 'TC-3.1',
          title: 'Duy trì nề nếp sinh hoạt Chi đoàn định kỳ hằng tháng và cập nhật đầy đủ sổ sách, phần mềm Quản lý đoàn viên',
          scoring_guide: 'Đạt 6 điểm khi sinh hoạt đủ 12 kỳ/năm và 100% dữ liệu đoàn viên được chuẩn hóa trên phần mềm.',
          evidence_requirement: 'Biên bản sinh hoạt Chi đoàn định kỳ, ảnh chụp danh sách phần mềm Quản lý đoàn viên.',
          max_score: 6,
        },
        {
          code: 'TC-3.2',
          title: 'Công tác phát triển đoàn viên mới và giới thiệu đoàn viên ưu tú cho Đảng xem xét kết nạp',
          scoring_guide: 'Đạt 5 điểm khi hoàn thành 100% chỉ tiêu phát triển đoàn viên mới và giới thiệu ít nhất 1 đoàn viên ưu tú.',
          evidence_requirement: 'Nghị quyết giới thiệu đoàn viên ưu tú, danh sách kết nạp đoàn viên mới.',
          max_score: 5,
        },
        {
          code: 'TC-3.3',
          title: 'Thực hiện thu, nộp đoàn phí và quản lý quỹ Chi đoàn đúng quy định, công khai minh bạch',
          scoring_guide: 'Đạt 4 điểm khi nộp đoàn phí đúng hạn 100% và có sổ theo dõi thu chi công khai.',
          evidence_requirement: 'Phiếu thu/biên nhận nộp đoàn phí về Đoàn xã, báo cáo tài chính Chi đoàn.',
          max_score: 4,
        },
      ],
    },
    {
      code: 'IV',
      title: 'Chế độ thông tin báo cáo và phối hợp thực hiện nhiệm vụ chính trị',
      description: 'Đánh giá tính kịp thời, đầy đủ của báo cáo định kỳ và sự phối hợp tham gia các hoạt động do Đoàn xã triệu tập.',
      max_score: 15,
      items: [
        {
          code: 'TC-4.1',
          title: 'Thực hiện đầy đủ, đúng hạn chế độ thông tin báo cáo tháng, quý, 6 tháng và báo cáo chuyên đề về Đoàn xã',
          scoring_guide: 'Đạt 5 điểm nếu 100% báo cáo đúng hạn; trừ 1 điểm cho mỗi lần nộp trễ hạn.',
          evidence_requirement: 'Bản lưu các báo cáo đã nộp và xác nhận tiếp nhận của Văn phòng Đoàn xã.',
          max_score: 5,
        },
        {
          code: 'TC-4.2',
          title: 'Tham dự đầy đủ các cuộc họp giao ban, tập huấn nghiệp vụ và hội nghị do Đoàn xã triệu tập',
          scoring_guide: 'Đạt 5 điểm khi tham dự >= 95% cuộc họp/tập huấn; 3 điểm nếu 80–94%; 0–2 điểm nếu dưới 80%.',
          evidence_requirement: 'Bảng tổng hợp điểm danh của Ban Chấp hành Đoàn xã.',
          max_score: 5,
        },
        {
          code: 'TC-4.3',
          title: 'Phối hợp tốt với Chi bộ, Ban nhân dân ấp hoặc Ban Giám hiệu trong chăm lo, đồng hành với thanh thiếu nhi',
          scoring_guide: 'Đạt 5 điểm khi có ít nhất 2 hoạt động phối hợp chăm lo thiếu nhi/thanh niên khó khăn có xác nhận.',
          evidence_requirement: 'Giấy xác nhận phối hợp, hình ảnh trao quà/học bổng, biên bản.',
          max_score: 5,
        },
      ],
    },
  ];

  const criterionIds2026: Record<string, number> = {};
  let groupOrder = 1;
  let itemOrder = 1;
  for (const g of fixedGroups) {
    const gRes = await db.query<{ id: number }>(
      `INSERT INTO criteria_groups (version_id, section_type, code, title, description, max_score, sort_order)
       VALUES ($1, 'fixed', $2, $3, $4, $5, $6) RETURNING id`,
      [v2026Id, g.code, g.title, g.description, g.max_score, groupOrder++],
    );
    const groupId = gRes.rows[0].id;
    for (const item of g.items) {
      const iRes = await db.query<{ id: number }>(
        `INSERT INTO criteria_items
          (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
         VALUES ($1, $2, 'fixed', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [v2026Id, groupId, item.code, item.title, item.scoring_guide, item.evidence_requirement, item.max_score, itemOrder++],
      );
      criterionIds2026[item.code] = iRes.rows[0].id;
    }
  }

  // 4. Seed Archived Scorecard Version 2025 (with both 60 fixed + 40 supplementary published for historical reference & cloning)
  const v2025Res = await db.query<{ id: number }>(
    `INSERT INTO scorecard_versions
      (code, title, year, period, version_number, status, fixed_max_cap, supplementary_max_cap, supplementary_published, supplementary_published_at, published_at, created_by)
     VALUES
      ('BD-2025-V1', 'Bảng điểm đánh giá Cơ sở Đoàn năm 2025 – Đợt tổng kết năm', 2025, 'Đợt tổng kết năm 2025', 1, 'archived', 60, 40, TRUE, NOW() - INTERVAL '320 days', NOW() - INTERVAL '365 days', $1)
     RETURNING id`,
    [adminId],
  );
  const v2025Id = v2025Res.rows[0].id;

  let gOrd25 = 1;
  let iOrd25 = 1;
  for (const g of fixedGroups) {
    const gRes = await db.query<{ id: number }>(
      `INSERT INTO criteria_groups (version_id, section_type, code, title, description, max_score, sort_order)
       VALUES ($1, 'fixed', $2, $3, $4, $5, $6) RETURNING id`,
      [v2025Id, g.code, g.title, g.description, g.max_score, gOrd25++],
    );
    for (const item of g.items) {
      await db.query(
        `INSERT INTO criteria_items
          (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
         VALUES ($1, $2, 'fixed', $3, $4, $5, $6, $7, $8)`,
        [v2025Id, gRes.rows[0].id, item.code, item.title, item.scoring_guide, item.evidence_requirement, item.max_score, iOrd25++],
      );
    }
  }
  const suppGroup25 = await db.query<{ id: number }>(
    `INSERT INTO criteria_groups (version_id, section_type, code, title, description, max_score, sort_order)
     VALUES ($1, 'supplementary', 'BS-I', 'Chủ đề công tác năm 2025 & Nhiệm vụ đột xuất của Đoàn xã', 'Nhóm tiêu chí bổ sung theo chỉ đạo trọng tâm năm 2025.', 40, $2) RETURNING id`,
    [v2025Id, gOrd25++],
  );
  const suppItems25 = [
    { code: 'BS-1.1', title: 'Triển khai mô hình Chuyển đổi số thanh niên tại địa bàn dân cư / đơn vị', guide: 'Đạt tối đa 20 điểm khi có mô hình vận hành thực tế, mang lại hiệu quả rõ nét.', ev: 'Báo cáo mô hình, hình ảnh, số liệu người dân tiếp cận.', max: 20 },
    { code: 'BS-1.2', title: 'Hưởng ứng Tháng Thanh niên và Chiến dịch Thanh niên tình nguyện Hè 2025', guide: 'Đạt tối đa 20 điểm khi hoàn thành vượt mức chỉ tiêu đợt cao điểm.', ev: 'Báo cáo tổng kết chiến dịch, hình ảnh hoạt động.', max: 20 },
  ];
  for (const si of suppItems25) {
    await db.query(
      `INSERT INTO criteria_items (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
       VALUES ($1, $2, 'supplementary', $3, $4, $5, $6, $7, $8)`,
      [v2025Id, suppGroup25.rows[0].id, si.code, si.title, si.guide, si.ev, si.max, iOrd25++],
    );
  }

  // 5. Seed Evaluations for 2026 across all workflow states so Dashboard is rich & immediately usable
  const allCodes = Object.keys(criterionIds2026);
  const maxByCode: Record<string, number> = {};
  for (const g of fixedGroups) {
    for (const item of g.items) {
      maxByCode[item.code] = item.max_score;
    }
  }

  async function seedEval(params: {
    unitCode: string;
    status: 'not_started' | 'self_assessing' | 'submitted' | 'under_review' | 'needs_revision' | 'completed';
    selfRatio?: number;
    reviewAdjustments?: Record<string, { delta: number; reason: string; comment: string; needsEvidence?: boolean }>;
    returnNote?: string;
    overallComment?: string;
    partialCount?: number;
  }) {
    const unitId = unitIds[params.unitCode];
    const unitUserId = unitUserMap[params.unitCode];
    const unitName = unitsData.find((u) => u.code === params.unitCode)?.name ?? params.unitCode;
    const secretary = unitsData.find((u) => u.code === params.unitCode)?.secretary_name ?? 'Bí thư Chi đoàn';

    const submittedAt = ['submitted', 'under_review', 'needs_revision', 'completed'].includes(params.status)
      ? new Date(Date.now() - 4 * 86400_000).toISOString()
      : null;
    const returnedAt = params.status === 'needs_revision' ? new Date(Date.now() - 2 * 86400_000).toISOString() : null;
    const confirmedAt = params.status === 'completed' ? new Date(Date.now() - 1 * 86400_000).toISOString() : null;

    const evRes = await db.query<{ id: number }>(
      `INSERT INTO evaluations
        (version_id, unit_id, status, submitted_at, submitted_by, returned_at, return_note, confirmed_at, confirmed_by, overall_comment, active_max_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 60)
       RETURNING id`,
      [
        v2026Id,
        unitId,
        params.status,
        submittedAt,
        submittedAt ? unitUserId : null,
        returnedAt,
        params.returnNote ?? '',
        confirmedAt,
        confirmedAt ? adminId : null,
        params.overallComment ?? '',
      ],
    );
    const evalId = evRes.rows[0].id;

    if (params.status === 'not_started') {
      await recalculateEvaluationTotals(db, evalId);
      return;
    }

    const limit = params.partialCount ?? allCodes.length;
    const ratio = params.selfRatio ?? 0.92;

    for (let idx = 0; idx < limit; idx++) {
      const code = allCodes[idx];
      const critId = criterionIds2026[code];
      const maxScore = maxByCode[code];
      const selfScore = Math.min(maxScore, Math.max(0, Math.round(maxScore * ratio * 2) / 2));

      const adj = params.reviewAdjustments?.[code];
      const hasReview = params.status === 'completed' || params.status === 'under_review' || (params.status === 'needs_revision' && Boolean(adj));
      const reviewScore = hasReview
        ? Math.min(maxScore, Math.max(0, selfScore + (adj?.delta ?? 0)))
        : null;

      await db.query(
        `INSERT INTO evaluation_scores
          (evaluation_id, criterion_id, self_score, explanation, review_score, adjustment_reason, reviewer_comment, needs_evidence, reviewed_by, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          evalId,
          critId,
          selfScore,
          `${unitName} đã triển khai đầy đủ nội dung tiêu chí ${code} theo kế hoạch năm 2026, có biên bản và hình ảnh lưu trữ.`,
          reviewScore,
          adj?.reason ?? '',
          adj?.comment ?? (hasReview ? 'Thống nhất điểm tự chấm của đơn vị.' : ''),
          Boolean(adj?.needsEvidence),
          hasReview ? reviewerId : null,
          hasReview ? new Date(Date.now() - 2 * 86400_000).toISOString() : null,
        ],
      );

      await db.query(
        `INSERT INTO score_history (evaluation_id, criterion_id, round, old_score, new_score, reason, actor_id, actor_name, actor_role)
         VALUES ($1, $2, 'self', NULL, $3, 'Cơ sở Đoàn nhập điểm tự đánh giá Vòng 1', $4, $5, 'unit')`,
        [evalId, critId, selfScore, unitUserId, secretary],
      );

      if (hasReview && reviewScore !== null) {
        await db.query(
          `INSERT INTO score_history (evaluation_id, criterion_id, round, old_score, new_score, reason, actor_id, actor_name, actor_role)
           VALUES ($1, $2, 'review', $3, $4, $5, $6, 'Trần Thị Bích Thảo', 'reviewer')`,
          [
            evalId,
            critId,
            selfScore,
            reviewScore,
            adj ? adj.reason : 'Giữ nguyên điểm tự đánh giá sau khi kiểm tra minh chứng',
            reviewerId,
          ],
        );
      }
    }

    await recalculateEvaluationTotals(db, evalId);
  }

  // Completed (2 units)
  await seedEval({
    unitCode: 'CD-AP1',
    status: 'completed',
    selfRatio: 0.96,
    reviewAdjustments: {
      'TC-2.3': { delta: -0.5, reason: 'Thiếu 1 ý tưởng hợp lệ trên Cổng Ngân hàng ý tưởng', comment: 'Đề nghị bổ sung thêm ý tưởng chuyển đổi số trong quý tới.' },
    },
    overallComment: 'Chi đoàn Ấp 1 triển khai đồng bộ, hồ sơ minh chứng đầy đủ, rõ ràng. Đạt Hoàn thành xuất sắc.',
  });

  await seedEval({
    unitCode: 'CD-THCS',
    status: 'completed',
    selfRatio: 0.93,
    reviewAdjustments: {
      'TC-1.2': { delta: -1, reason: 'Tần suất chia sẻ tuyến bài tuyên truyền chưa đủ 2 bài/tháng trong quý III', comment: 'Cần tăng cường tương tác trên fanpage Tuổi trẻ Tân Nhựt.' },
    },
    overallComment: 'Đơn vị hoạt động tốt công tác giáo dục truyền thống và chăm lo đội viên, thiếu nhi.',
  });

  // Under Review (1 unit)
  await seedEval({
    unitCode: 'CD-CQ',
    status: 'under_review',
    selfRatio: 0.9,
    reviewAdjustments: {
      'TC-2.1': { delta: -1, reason: 'Hồ sơ công trình thanh niên chưa đính kèm ảnh nghiệm thu hoàn thành', comment: 'Tạm điều chỉnh 1 điểm, đề nghị xác nhận lại trước khi chốt.' },
    },
  });

  // Submitted waiting for review (2 units)
  await seedEval({ unitCode: 'CD-AP2', status: 'submitted', selfRatio: 0.88 });
  await seedEval({ unitCode: 'CD-CAQS', status: 'submitted', selfRatio: 0.91 });

  // Needs Revision (1 unit)
  await seedEval({
    unitCode: 'CD-AP3',
    status: 'needs_revision',
    selfRatio: 0.85,
    returnNote: 'Đề nghị Chi đoàn Ấp 3 bổ sung minh chứng biên bản sinh hoạt Chi đoàn quý III (TC-3.1) và phiếu thu đoàn phí (TC-3.3) trước khi gửi lại.',
    reviewAdjustments: {
      'TC-3.1': { delta: -1.5, reason: 'Thiếu biên bản sinh hoạt tháng 8 và tháng 9/2026', comment: 'Yêu cầu bổ sung bản scan biên bản có ký xác nhận.', needsEvidence: true },
      'TC-3.3': { delta: -1, reason: 'Chưa đính kèm biên nhận nộp đoàn phí đợt 2', comment: 'Yêu cầu tải ảnh chụp phiếu thu của Đoàn xã.', needsEvidence: true },
    },
  });

  // Self Assessing in progress (1 unit — 7/12 criteria filled)
  await seedEval({ unitCode: 'CD-AP4', status: 'self_assessing', selfRatio: 0.86, partialCount: 7 });

  // Not Started (1 unit)
  await seedEval({ unitCode: 'CD-TH', status: 'not_started' });

  // Seed initial audit logs
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, summary)
     VALUES
      ($1, 'Nguyễn Văn An', 'admin', 'PUBLISH_SCORECARD', 'scorecard_version', $2, 'Công bố Bảng điểm đánh giá Cơ sở Đoàn năm 2026 – Đợt tổng kết năm (60 điểm cố định, 40 điểm bổ sung chưa thiết lập)'),
      ($3, 'Trần Thị Bích Thảo', 'reviewer', 'RETURN_EVALUATION', 'evaluation', 'CD-AP3', 'Trả hồ sơ Chi đoàn Ấp 3 để bổ sung minh chứng tiêu chí TC-3.1 và TC-3.3'),
      ($1, 'Nguyễn Văn An', 'admin', 'CONFIRM_EVALUATION', 'evaluation', 'CD-AP1', 'Xác nhận kết quả thẩm định chính thức cho Chi đoàn Ấp 1')`,
    [adminId, String(v2026Id), reviewerId],
  );
}
