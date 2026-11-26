import type { DbClient } from './client.js';
import { hashPassword } from '../auth.js';

const MOCK_USERNAMES = [
  'thamdinh',
  'cd_ap1',
  'cd_ap2',
  'cd_ap3',
  'cd_ap4',
  'cd_thcs',
  'cd_th',
  'cd_cq',
  'cd_caqs',
];

const MOCK_UNIT_CODES = [
  'CD-AP1',
  'CD-AP2',
  'CD-AP3',
  'CD-AP4',
  'CD-THCS',
  'CD-TH',
  'CD-CQ',
  'CD-CAQS',
];

export async function seedIfEmpty(db: DbClient): Promise<void> {
  // 1. Clean up any previously seeded mock data from earlier builds
  const hasMockUsers = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM users WHERE username = ANY($1::text[])`,
    [MOCK_USERNAMES],
  );
  const hasMockUnits = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM units WHERE code = ANY($1::text[])`,
    [MOCK_UNIT_CODES],
  );

  if (Number(hasMockUsers.rows[0]?.cnt ?? 0) > 0 || Number(hasMockUnits.rows[0]?.cnt ?? 0) > 0) {
    // Delete mock units (cascades evaluations, evaluation_scores, evidence_files, score_history)
    await db.query(`DELETE FROM units WHERE code = ANY($1::text[])`, [MOCK_UNIT_CODES]);
    // Delete mock non-admin users (cascades their sessions)
    await db.query(`DELETE FROM users WHERE username = ANY($1::text[])`, [MOCK_USERNAMES]);
    // Delete mock archived 2025 scorecard & mock audit logs
    await db.query(`DELETE FROM scorecard_versions WHERE code = 'BD-2025-V1'`);
    await db.query(`DELETE FROM audit_logs WHERE entity_id IN ('CD-AP1', 'CD-AP3') OR actor_name = 'Trần Thị Bích Thảo'`);
  }

  // 2. Ensure default Admin account exists (ONLY account created by default)
  const existingAdmin = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
  );

  let adminId: number;
  if (existingAdmin.rows.length === 0) {
    const adminPass = hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'admin123');
    const adminRes = await db.query<{ id: number }>(
      `INSERT INTO users (username, password_hash, full_name, role, unit_id, title)
       VALUES ('admin', $1, 'Quản trị viên Đoàn xã Tân Nhựt', 'admin', NULL, 'Quản trị viên hệ thống')
       RETURNING id`,
      [adminPass],
    );
    adminId = adminRes.rows[0].id;
  } else {
    adminId = existingAdmin.rows[0].id;
  }

  // 3. Ensure at least one clean 2026 Scorecard Version (60 fixed pts + 40 supplementary empty) exists
  const existingVersions = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM scorecard_versions`,
  );
  if (Number(existingVersions.rows[0]?.cnt ?? 0) > 0) return;

  const v2026Res = await db.query<{ id: number }>(
    `INSERT INTO scorecard_versions
      (code, title, year, period, version_number, status, fixed_max_cap, supplementary_max_cap, supplementary_published, published_at, created_by)
     VALUES
      ('BD-2026-V1', 'Bảng điểm đánh giá Cơ sở Đoàn năm 2026 – Đợt tổng kết năm', 2026, 'Đợt tổng kết năm 2026', 1, 'published', 60, 40, FALSE, NOW(), $1)
     RETURNING id`,
    [adminId],
  );
  const v2026Id = v2026Res.rows[0].id;

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
      await db.query(
        `INSERT INTO criteria_items
          (version_id, group_id, section_type, code, title, scoring_guide, evidence_requirement, max_score, sort_order)
         VALUES ($1, $2, 'fixed', $3, $4, $5, $6, $7, $8)`,
        [v2026Id, groupId, item.code, item.title, item.scoring_guide, item.evidence_requirement, item.max_score, itemOrder++],
      );
    }
  }
}
