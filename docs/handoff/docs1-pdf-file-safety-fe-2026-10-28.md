# DOCS1 — Handoff FE: an toàn đổi file và lưu ghi chú PDF

Ngày: 2026-10-28. Ứng dụng: `https://langoo.org/pdf`.
Repo FE: `LanGoo-User`. Ưu tiên P1 trước P2, nghiệm thu cả hai trước khi đóng việc.

## Mục tiêu

Không ghi nội dung PDF vào nhầm file gốc; không làm mất ghi chú khi đổi tài liệu
mà người dùng chưa xác nhận. Giữ cách đọc PDF local hiện tại. Không cần thêm
API backend hoặc migration PostgreSQL cho hai lỗi này.

Kết quả khảo sát: [report](../reviews/docs1-web-pdf-check-2026-10-28.md).
Hai finding đã tái hiện bằng hook thực tế với dependencies giả lập và đối chiếu
bundle production; chưa thao tác E2E trên browser thật. FE phải tái hiện và
nghiệm thu lại bằng file thử nghiệm, không dùng tài liệu quan trọng.

## 1. P1 — Khôi phục nhầm file handle

### Tái hiện

Chuẩn bị A.pdf và B.pdf có nội dung khác nhau, dùng Chrome/Edge hỗ trợ
`showOpenFilePicker` trên HTTPS hoặc localhost.

1. Vào `/pdf`, bấm mở file và chọn A.pdf bằng picker.
2. Kéo thả B.pdf vào trang; giao diện hiển thị B.
3. Chuyển sang route khác rồi quay lại `/pdf`; kiểm thêm trường hợp reload.
4. Thêm ghi chú trên B, bấm lưu; chấp nhận quyền ghi nếu trình duyệt hỏi.
5. Kiểm tra nội dung A trên đĩa: luồng hiện tại có thể ghi nội dung B vào A.

### Nguyên nhân đã xác định

`src/hooks/use-pdf.ts`, hàm `loadFile`: dùng lại session ID; lưu bytes và meta
của file mới, nhưng chỉ gọi `saveSessionHandle` khi `handle` có giá trị. File
kéo thả không có handle nên handle A cũ vẫn tồn tại trong IndexedDB.
Restore đọc bytes và handle độc lập rồi ghép chúng vào cùng tài liệu.

Các file cần đọc/sửa: `src/hooks/use-pdf.ts`, `src/lib/pdf-session.ts`,
`src/lib/pdf-fs.ts`; cập nhật caller trong `src/pages/pdf/index.tsx` nếu cần.

### Yêu cầu sửa

- Khi thay tài liệu, bytes, tên file, meta và handle phải thuộc **cùng một lần
  nạp tài liệu**. Không sử dụng session ID theo tab làm bằng chứng rằng chúng
  cùng tài liệu; không chỉ so sánh tên file vì hai file có thể trùng tên.
- Mở qua picker: handle đi cùng đúng file được chọn. Kéo thả/input thông thường:
  handle phải là `null`, cả trong RAM lẫn dữ liệu khôi phục; lưu dùng tải xuống.
- Ghi snapshot phiên nhất quán: dùng cùng transaction IndexedDB cho các phần
  liên quan, hoặc một bản ghi snapshot; có thể dùng document ID/revision để
  kiểm tra sự tương ứng. FE chọn cách triển khai phù hợp, nhưng reload giữa
  các bước ghi không được tạo cặp bytes mới + handle cũ.
- Restore chỉ bật ghi vào file gốc khi xác minh được handle thuộc cùng snapshot
  tài liệu. Thiếu handle, thiếu quyền hoặc snapshot không nhất quán: giữ tài
  liệu đọc được và chuyển sang tải xuống; không chọn handle khác để thay thế.
- **Phiên cũ trước bản sửa:** không đủ thông tin chứng minh cặp bytes/handle hợp
  lệ thì bỏ liên kết ghi gốc và dùng tải xuống. Giữ bytes và ghi chú có thể khôi
  phục; không xoá toàn bộ IndexedDB để né lỗi. Mở lại qua picker mới thiết lập
  liên kết ghi gốc đáng tin cậy.
- Hoàn thành bất đồng bộ của lần mở/lưu cũ không được gắn handle, bytes hoặc
  meta trở lại tài liệu mới. Chặn đổi file trong lúc lưu, hoặc kiểm tra ID/revision
  khi hoàn thành; không chỉ kiểm tra kết quả render của pdf.js.
- Trạng thái nút lưu phải đúng: file không có handle dùng tải xuống; chỉ hiển
  thị lưu vào file gốc khi có liên kết hợp lệ. Quyền bị từ chối hoặc ghi lỗi
  phải có fallback tải xuống, không báo lưu gốc thành công.

## 2. P2 — Đổi file làm mất ghi chú chưa lưu

### Tái hiện và nguyên nhân

Mở A, vẽ/bôi màu chưa lưu, sau đó mở B qua picker hoặc kéo thả. `loadFile`
hiện reset annotations và ghi meta rỗng. Confirm `dirty` chỉ có trong
`handleClose`; các đường thay file gọi load trực tiếp.

### Yêu cầu sửa

- Dùng chung một luồng thay tài liệu cho picker, input fallback và drag/drop.
- Nếu đang có ghi chú chưa lưu, phải xác nhận trước khi bỏ chúng. Có thể dùng
  confirm hiện có: “Tài liệu đang có ghi chú chưa lưu. Đổi file sẽ bỏ các ghi
  chú này. Bạn có muốn tiếp tục?” với hai lựa chọn “Giữ tài liệu hiện tại” và
  “Bỏ ghi chú và đổi file”. Không bắt buộc thêm cơ chế tự lưu.
- Huỷ xác nhận hoặc huỷ picker: giữ nguyên tài liệu, ghi chú, trang, zoom,
  handle và snapshot phiên; không reset trước khi biết người dùng tiếp tục.
- Chỉ thay tài liệu đang dùng sau khi đọc/parse file mới thành công. Nếu file
  mới lỗi, không hợp lệ hoặc không mở được: báo lỗi và giữ tài liệu cũ cùng
  ghi chú để người dùng còn lưu. Giải phóng worker/object URL của ứng viên lỗi.
- Confirm trước khi gọi picker phải giữ được user activation cần cho API chọn
  file; FE kiểm thực tế trên Chrome/Edge. Không để sửa confirm làm hỏng picker.

## 3. Checklist nghiệm thu bắt buộc

| Ca kiểm tra | Kết quả cần đạt |
|---|---|
| Picker A → thả B → đổi route → quay lại → ghi chú/lưu | A không đổi; tải xuống B có ghi chú |
| Picker A → thả B → reload → ghi chú/lưu | Như trên; không restore handle A |
| Picker A → input fallback B → restore | B không có quyền ghi A |
| Picker A → picker B → restore → lưu | Chỉ B được ghi; A không đổi |
| Hai file khác nội dung nhưng cùng tên | Không liên kết bằng tên, không ghi nhầm |
| Phiên legacy chứa bytes B + handle A | Đọc được B; chỉ tải xuống; A không đổi |
| Thiếu/hỏng handle hoặc quyền ghi bị từ chối | Tải xuống được; không báo lưu gốc thành công |
| A dirty → mở/thả B → huỷ xác nhận | A, ghi chú và phiên còn nguyên |
| A dirty → chấp nhận bỏ ghi chú → B hợp lệ | B được mở, không mang ghi chú/handle A |
| A dirty → chọn file hỏng/không phải PDF | Báo lỗi; A và ghi chú vẫn lưu được |
| Huỷ picker; mở B/C liên tiếp; lưu đang chạy | Không xoá dữ liệu hoặc để tác vụ cũ sửa phiên mới |
| IndexedDB lỗi/không khả dụng | Đọc local vẫn hoạt động; không ghép handle sai |
| Ghi gốc hợp lệ và tải xuống | Mở lại file kết quả thấy đúng ghi chú, không vẽ lặp |

Regression tự động nên tập trung vào invariant bytes/meta/handle cùng tài liệu,
legacy restore và huỷ đổi file khi dirty. Browser smoke Chrome/Edge phải kiểm
quyền ghi/restore thật; thêm trình duyệt không hỗ trợ picker và mobile cho
fallback input/tải xuống. So sánh hash file A trước/sau các ca chống ghi nhầm.

## 4. Đầu ra FE cần bàn giao

- Commit/hash, danh sách file sửa và mô tả cách bảo đảm snapshot nhất quán.
- Cách xử lý phiên legacy và kết quả regression/browser smoke theo checklist.
- Bằng chứng file A không đổi và file kết quả chứa đúng ghi chú; ghi rõ ca
  chưa kiểm được, không đánh dấu pass thay cho việc chưa chạy.
- URL preview/deploy và build ID khi có triển khai; kiểm lại bản đã deploy.

Trạng thái handoff: đã soạn; hai lỗi chưa sửa, chưa nghiệm thu browser. Tài liệu
và PROGRESS chưa commit/push ở thời điểm soạn; không có deploy trong lượt này.
