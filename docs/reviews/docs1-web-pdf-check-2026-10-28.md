# DOCS1 — Kiểm tra chức năng đọc PDF trên langoo.org

Ngày: 2026-10-28. Phạm vi được yêu cầu: kiểm tra web và chức năng đọc PDF.

## Kết luận

Hạ tầng phục vụ trang PDF và các tài nguyên được kiểm tra hoạt động. Chưa nghiệm
thu toàn bộ giao diện vì công cụ trình duyệt trả về không có browser kết nối.
Phát hiện hai lỗi FE qua source, đối chiếu bundle production và kiểm thử logic
cách ly. Không sửa FE, không ghi file người dùng, không đổi production/DB.

## Bằng chứng bản web

- `https://langoo.org` và `/pdf`: HTTP 200, HTML app shell; đây chưa chứng minh
  React mount hoặc render tài liệu thành công.
- Entry: `/assets/index-RJr8sHki.js`; PDF route chunk:
  `/assets/index-CwnE_hKY.js` (26.022 bytes, SHA256
  `73d04fc7039eb2f744276090c3d356170ef7fb0f77ad0b3d6f2acc5abe330643`).
- 16 chunk index/vendor PDF được tải để đối chiếu đều 200, JavaScript MIME.
- Worker cấu hình thực tế `/assets/pdf.worker.min-CjEcRF4W.mjs`: 200,
  JavaScript, 1.264.342 bytes. Chuỗi fallback của thư viện `./pdf.worker.mjs`
  trả HTML nhưng không phải URL worker ứng dụng đang cấu hình; không tính là lỗi.
- `/pdfjs/cmaps/UniJIS-UTF16-H.bcmap`: 200, binary, 39.443 bytes.
- `/pdfjs/standard_fonts/LiberationSans-Regular.ttf`: 200, font, 139.512 bytes.
- `/assets/vendor-pdflib-Dz6TDafX.js`: 200, JavaScript, 437.041 bytes.
- PDF mở local bằng pdf.js; nội dung file không cần gửi API để render. CORS API
  có thể ảnh hưởng tra từ/dịch đi kèm, không quyết định mở file local.

## Finding P1 — Khôi phục nhầm file handle, có thể ghi đè file khác

Source FE: `../LanGoo-User/src/hooks/use-pdf.ts:157-161`, `:183-200`, hàm `save`.

1. Mở A.pdf qua nút chọn file trên trình duyệt hỗ trợ File System Access API.
2. Kéo thả B.pdf vào cùng trang. Session ID được dùng lại; bytes đổi thành B
   nhưng handle A trong IndexedDB không bị xoá vì chỉ lưu handle khi tham số có giá trị.
3. Rời route rồi quay lại hoặc reload: bytes B được ghép với handle A còn lưu.
4. Thêm ghi chú, bấm lưu. Khi có/cấp quyền ghi, nội dung B có thể ghi vào A.

Đã chạy `node /tmp/langoo-pdf-audit.cjs` trên Node v25.9.0: transpile **hook
thực tế** bằng TypeScript, giả lập React hooks, session storage và thao tác file.
Assertion xác nhận session giữ `B.pdf` + handle `A.pdf`; gọi save sau restore
chọn mode `overwrite`, đích ghi giả lập là `A.pdf`. Không dùng trình duyệt,
IndexedDB thật hoặc file thật; đây là tái hiện logic cách ly, chưa E2E.
Bundle live có cùng nhánh `q && ft(L,q)` khi đổi file và restore handle độc lập.

Hướng sửa FE: khi đổi tài liệu phải thay/xoá handle lưu trữ cùng bytes và meta;
không để handle tài liệu trước tồn tại cho tài liệu mới. Thêm regression cho
mở A bằng picker → thả B → restore → save, xác nhận tuyệt đối không ghi A.

## Finding P2 — Đổi file làm mất ghi chú chưa lưu mà không hỏi

Source FE: `../LanGoo-User/src/pages/pdf/index.tsx` (`loadFile`, `handleFiles`,
`openPicker`, `onDrop`), `../LanGoo-User/src/hooks/use-pdf.ts:152-159`.

Chỉ nút đóng tài liệu có confirm khi `dirty`. Mở file khác hoặc kéo thả gọi
`loadFile` trực tiếp, reset annotations và ghi meta mới vào cùng session.
Kiểm thử logic trên cũng xác nhận thêm annotation rồi load file mới sẽ thay
meta bằng annotations rỗng. Bundle live có cùng luồng này.

Hướng sửa FE: dùng một cổng kiểm tra ghi chú chưa lưu cho cả picker và drop;
người dùng huỷ thì giữ tài liệu/ghi chú đang có. Kiểm thêm tình huống file mới lỗi.

## Gate còn thiếu / trạng thái

- Chưa thao tác thực tế: mở PDF EN/JA, canvas/text selection, tra từ, zoom,
  cuộn, bôi màu/vẽ, tải file đã ghi chú, mobile, offline, reload và quyền ghi.
- Chưa thử PDF scan, PDF mã hoá, file lớn hoặc PDF có ảnh dùng decoder WASM.
- FE checkout HEAD `3f7d325` có nhiều WIP của công việc khác; chỉ đọc, không sửa
  hoặc coi HEAD đó là toàn bộ build production. Finding đã đối chiếu bundle live.
- Git backend nền `fefe5ab`; lượt này chỉ thêm report và entry PROGRESS, chưa
  commit/push. Không deploy. Hai finding còn mở, ưu tiên sửa P1 trước.
