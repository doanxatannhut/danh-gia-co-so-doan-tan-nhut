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

const OFFICIAL_UNITS: { code: string; name: string; unit_type: string }[] = [
  // 26 Chi đoàn Ấp (Địa bàn dân cư)
  ...Array.from({ length: 26 }, (_, idx) => {
    const num = idx + 1;
    return {
      code: `CD-AP${String(num).padStart(2, '0')}`,
      name: `Chi đoàn Ấp ${num}`,
      unit_type: 'dia_ban_dan_cu',
    };
  }),
  // 21 Cơ sở Đoàn khối Trường học
  { code: 'CD-MN-HAD', name: 'Chi đoàn Trường Mầm non Hoa Anh Đào', unit_type: 'truong_hoc' },
  { code: 'CD-MN-BB', name: 'Chi đoàn Trường Mầm non BaBy', unit_type: 'truong_hoc' },
  { code: 'CD-MN-HA', name: 'Chi đoàn Trường Mầm non Hoàng Anh', unit_type: 'truong_hoc' },
  { code: 'CD-TH-TN', name: 'Chi đoàn Trường Tiểu học Tân Nhựt', unit_type: 'truong_hoc' },
  { code: 'CD-TH-LTV', name: 'Chi đoàn Trường Tiểu học Lương Thế Vinh', unit_type: 'truong_hoc' },
  { code: 'CD-TH-TT', name: 'Chi đoàn Trường Tiểu học Tân Túc', unit_type: 'truong_hoc' },
  { code: 'CD-TH-TK', name: 'Chi đoàn Trường Tiểu học Tân Kiên', unit_type: 'truong_hoc' },
  { code: 'CD-THCS-TN', name: 'Chi đoàn Trường THCS Tân Nhựt', unit_type: 'truong_hoc' },
  { code: 'CD-THCS-TK', name: 'Chi đoàn Trường THCS Tân Kiên', unit_type: 'truong_hoc' },
  { code: 'CD-THCS-TT', name: 'Chi đoàn Trường THCS Tân Túc', unit_type: 'truong_hoc' },
  { code: 'CD-MN-MT', name: 'Chi đoàn Trường Mầm non Minh Thư', unit_type: 'truong_hoc' },
  { code: 'CD-MN-HHD', name: 'Chi đoàn Trường Mầm non Hoa Hướng Dương', unit_type: 'truong_hoc' },
  { code: 'CD-MN-HQ', name: 'Chi đoàn Trường Mầm non Hoa Quỳnh', unit_type: 'truong_hoc' },
  { code: 'CD-MG-TK', name: 'Chi đoàn Lớp Mẫu giáo Tân Kiên', unit_type: 'truong_hoc' },
  { code: 'CD-MG-NS', name: 'Chi đoàn Lớp Mẫu giáo Ngôi Sao', unit_type: 'truong_hoc' },
  { code: 'CD-MG-TNAU', name: 'Chi đoàn Lớp Mẫu giáo Thỏ Nâu', unit_type: 'truong_hoc' },
  { code: 'CD-MG-VQST', name: 'Chi đoàn Lớp Mẫu giáo Vương Quốc Sáng Tạo', unit_type: 'truong_hoc' },
  { code: 'DT-THPT-TT', name: 'THPT Tân Túc', unit_type: 'truong_hoc' },
  { code: 'DT-GDNN-GDTX', name: 'GDNN - GDTX', unit_type: 'truong_hoc' },
  { code: 'CDGV-THPT-TT', name: 'CDGV THPT Tân Túc', unit_type: 'truong_hoc' },
  { code: 'CDGV-GDNN', name: 'CĐGV GDNN - GDTX', unit_type: 'truong_hoc' },
  // 8 Cơ sở Đoàn khối Cơ quan – Y tế
  { code: 'CD-VHXH', name: 'Chi đoàn Phòng Văn hóa - Xã hội xã', unit_type: 'co_quan' },
  { code: 'D-MTTQ', name: 'Đoàn Cơ quan Ủy ban Mặt trận Tổ quốc Việt Nam xã', unit_type: 'co_quan' },
  { code: 'CD-BQLDA', name: 'Chi đoàn Ban Quản lý Dự án - Đầu tư xã', unit_type: 'co_quan' },
  { code: 'CD-VPDKDD', name: 'Chi đoàn Văn phòng Đăng ký Đất đai', unit_type: 'co_quan' },
  { code: 'D-BVTMHH', name: 'Đoàn Bệnh viện Truyền máu Huyết học', unit_type: 'co_quan' },
  { code: 'D-BVNDTP', name: 'Đoàn Bệnh viện Nhi đồng Thành phố', unit_type: 'co_quan' },
  { code: 'CD-TYT', name: 'Chi đoàn Trạm Y tế xã', unit_type: 'co_quan' },
  { code: 'CD-BVBC', name: 'Chi đoàn Bệnh viện Đa khoa Bình Chánh', unit_type: 'co_quan' },
];

export async function seedIfEmpty(db: DbClient): Promise<void> {
  // 1. Clean up any previously seeded mock data & sample scorecards
  await db.query(`DELETE FROM units WHERE code = ANY($1::text[])`, [MOCK_UNIT_CODES]);
  await db.query(`DELETE FROM users WHERE username = ANY($1::text[])`, [MOCK_USERNAMES]);
  await db.query(`DELETE FROM scorecard_versions WHERE code IN ('BD-2025-V1', 'BD-2026-V1')`);
  await db.query(`DELETE FROM audit_logs WHERE entity_id IN ('CD-AP1', 'CD-AP3') OR actor_name = 'Trần Thị Bích Thảo'`);

  // 2. Ensure default Admin account exists (ONLY account created by default)
  const existingAdmin = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
  );

  if (existingAdmin.rows.length === 0) {
    const adminPass = hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'admin123');
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, unit_id, title)
       VALUES ('admin', $1, 'Quản trị viên Đoàn xã Tân Nhựt', 'admin', NULL, 'Quản trị viên hệ thống')`,
      [adminPass],
    );
  }

  // 3. Seed all 55 official Cơ sở Đoàn trực thuộc Đoàn xã Tân Nhựt & auto-create their login accounts (username = Mã đơn vị, password = Bcda@1234)
  const defaultUnitPassHash = hashPassword(process.env.DEFAULT_UNIT_PASSWORD || 'Bcda@1234');
  for (const u of OFFICIAL_UNITS) {
    await db.query(
      `INSERT INTO units (code, name, unit_type, secretary_name, phone, member_count, active)
       VALUES ($1, $2, $3, '', '', 0, TRUE)
       ON CONFLICT (code) DO NOTHING`,
      [u.code, u.name, u.unit_type],
    );
  }

  // Ensure every active Cơ sở Đoàn has a direct login account (username = lower(code), password = Bcda@1234)
  const allUnits = await db.query<{ id: number; code: string; name: string }>(
    `SELECT id, code, name FROM units WHERE active = TRUE`,
  );
  for (const unit of allUnits.rows) {
    await db.query(
      `INSERT INTO users (username, password_hash, full_name, role, unit_id, title, active)
       VALUES ($1, $2, $3, 'unit', $4, 'Tài khoản Cơ sở Đoàn', TRUE)
       ON CONFLICT (username) DO NOTHING`,
      [unit.code.toLowerCase(), defaultUnitPassHash, unit.name, unit.id],
    );
  }
}
