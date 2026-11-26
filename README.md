# Phân hệ Đánh giá, Chấm điểm Cơ sở Đoàn – Dashboard Tuổi trẻ Tân Nhựt

Phân hệ quản lý đánh giá, chấm điểm hai vòng và xếp loại chất lượng hoạt động của các Cơ sở Đoàn trực thuộc **Đoàn TNCS Hồ Chí Minh xã Tân Nhựt**.

## Tính năng chính

1. **Cấu trúc bảng điểm 100 điểm linh hoạt (60 cố định + 40 bổ sung)**
   - 60 điểm cố định thiết lập sẵn, áp dụng thống nhất.
   - 40 điểm bổ sung ban đầu để trống, không tự động tính thành 0 điểm; chỉ có hiệu lực sau khi Quản trị viên Đoàn xã nhấn **Công bố**.
   - Kiểm soát trần điểm chặt chẽ (`Cố định ≤ 60`, `Bổ sung ≤ 40`, `Tổng ≤ 100`).
   - Quản lý phiên bản bảng điểm theo năm/đợt đánh giá, hỗ trợ sao chép từ năm trước và khóa bảo vệ khi đã có hồ sơ đang đánh giá.

2. **Quy trình đánh giá hai vòng**
   - **Vòng 1 (Cơ sở Đoàn tự đánh giá)**: Tự động lưu bản nháp, nhập điểm, viết giải trình, tải minh chứng (Ảnh, PDF, Word, Excel), kiểm tra tiêu chí chưa hoàn thành, gửi hồ sơ và tự động khóa chỉnh sửa.
   - **Vòng 2 (Đoàn xã thẩm định)**: Xem hồ sơ & tải minh chứng, giữ nguyên hoặc điều chỉnh điểm (**bắt buộc ghi lý do khi điều chỉnh**), gắn cờ yêu cầu bổ sung minh chứng, trả hồ sơ để mở khóa chỉnh sửa, hoặc xác nhận kết quả chính thức. Lưu đầy đủ lịch sử thay đổi điểm theo từng tiêu chí.

3. **Dashboard, Báo cáo & Bảo mật**
   - Tổng quan 7 chỉ số trạng thái, biểu đồ tiến độ và so sánh điểm (Recharts), bảng điểm phân màu trực quan (Xanh dương / Cam / Xám / Vàng / Xanh lá).
   - Tự động tổng hợp chênh lệch, xếp hạng, xếp loại; xuất **Excel (.xlsx)**, **PDF (.pdf)** và **In trực tiếp**.
   - Phân quyền 3 vai trò (`admin`, `reviewer`, `unit`), cô lập dữ liệu từng Cơ sở Đoàn, tệp minh chứng có xác thực và **Nhật ký hoạt động (Audit Log)**.

## Tài khoản trải nghiệm mặc định

| Vai trò | Tên đăng nhập | Mật khẩu |
|---|---|---|
| Quản trị viên Đoàn xã | `admin` | `admin123` |
| Cán bộ thẩm định | `thamdinh` | `thamdinh123` |
| Cơ sở Đoàn (Chi đoàn Ấp 1..4, THCS, Tiểu học, Cơ quan, CA-QS) | `cd_ap1`, `cd_ap2`, `cd_ap3`, `cd_ap4`, `cd_thcs`, `cd_th`, `cd_cq`, `cd_caqs` | `doan123` |

## Chạy ứng dụng

```bash
# Chạy chế độ phát triển (API port 4100 + Vite Web port 5175)
npm run dev

# Hoặc build & chạy bản production (port 4100)
npm run build
npm start

# Chạy bộ kiểm thử tự động
npm test
```
