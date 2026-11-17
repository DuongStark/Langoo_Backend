# M12-A06.1/A12 — Handoff FE: tra ngược có preview và mã Nhật (A3F0C7)

Ngày17/11/2026. FeedbackA3F0C7. **Code đã kiểm local, chưa xác nhận deploy bản bổ sung.**

Áp dụng đồng thời:
- GET /v1/dictionary/reverse
- GET /v1/dictionary/suggestions/reverse

## FE cần dùng

1. Cả en[]/ja[] thêm `preview: SenseCardDto|null`, cùng schema như search.preview.
   Đọc gloss_vi trước, fallback gloss_en/sense_hint theo locale và chính sách UI.
   Giữ badge khi gloss_vi_machine=true và gloss_vi_reviewed không phải true.
2. ja[] thêm `lexeme_id:string|null`, `sense_id:string|null`. Đây là mã Nhật.
   Khi có lexeme_id, mở chi tiết lexeme trực tiếp; nếu có sense_id thì chọn nghĩa đó.
   Nếu sense_id=null thì mở danh sách nghĩa, không tự chọn nghĩa đầu.
3. lexeme_id=null nghĩa chưa xác định chắc mục Nhật; giữ nhánh tra mặt chữ cũ.
   Không dùng via_lexeme_id làm mã Nhật: đó vẫn là EN trung gian như trước.
4. Giữ các trường cũ và alias camelCase, không đổi query/order/limit/scope/history.
   exact_sense vẫn theo quan hệ hint cũ; không phải chứng nhận semantic mới.

Ví dụ rút gọn của một phần tử ja[] (preview thực có đầy đủ SenseCardDto):

```json
{
  "text": "植物",
  "lexeme_id": "140202",
  "sense_id": "148381",
  "via_lexeme_id": "1628685",
  "via_lemma": "plant",
  "sense_hint": "organism capable of photosynthesis",
  "exact_sense": true,
  "preview": {
    "sense_id": "148381",
    "lexeme_id": "140202",
    "gloss_vi": "cây, thực vật; thảm thực vật",
    "gloss_en": "plant"
  }
}
```

## Quy tắc chọn nghĩa và giới hạn

- EN ưu tiên source_sense_id của assertion đã khớp, kiểm sense thuộc đúng lexeme.
  Khi không có source sense, chỉ chọn bằng hint/gloss rõ ràng hoặc trường hợp
  không có hint và chỉ một nghĩa; không lấy nghĩa đầu theo thứ tự.
- JA kiểm target accepted, hint/gloss khớp hoặc mapping exact/verified/curated
  với confidence>=0.7, và áp hạn chế form của sense. Pending không được dùng
  như accepted. Nếu chỉ dựa mặt chữ thì ưu tiên nguồn JMdict và yêu cầu xác định
  lexeme rõ ràng; một nghĩa duy nhất mới có thể dùng làm fallback preview.
- Nhiều sense cùng bằng chứng: sense_id/preview=null. Nhiều homograph chưa phân
  biệt được: lexeme_id cũng null. Không tạo mapping/dịch AI hoặc sửa DB từ request.
- Profile JA-only: en[] rỗng, via_lemma rỗng như contract cũ; preview là JA.
- Đọc resolver và preview theo nhóm của trang, không gọi search/detail mỗi dòng.
- Không sửa dữ liệu “of→nước” hoặc các assertion sai khác trong đợt này.

## QA FE cần làm

- Tra cây và gợi ý cây: thấy nghĩa Việt; bấm 植物 mở thẳng chi tiết đúng nghĩa.
- Kết quả nhiều nghĩa không tự nhảy nghĩa đầu; unknown/null giữ fallback.
- Đổi JA-only/EN-only/bilingual không trộn cache hoặc hiện preview ngoài scope.
- Không cần query search phụ chỉ để lấy ID; giữ lỗi/loading khi request detail lỗi.
- Kiểm badge bản dịch máy và cả trường hợp gloss_vi thiếu.

[Plan](../plans/m12-a3f0c7-reverse-preview-2026-11-17.md) ·
[Report/test/deploy](../reviews/m12-a3f0c7-reverse-preview-2026-11-17.md).

## Ledger

- Unit local77suite/689test PASS trên working tree đang có WIP quiz ngoài phạm vi;
  testdictionary52pass. HTTPDB3suite/43test PASS, mở rộng8test semantic/form PASS.
- Build/lint local PASS; CI của commit phát hành sẽ xác nhận đúng source đã đóng gói.
- Phép đọc repo mới trên production READ ONLY: cây/plant/植物 xác định đúng ID,
  resolver98ms cho2reference mẫu; không phải HTTP P95 hoặc benchmark rộng.
- Chưa sửa source FE; không tự đóng feedback chỉ từ testlocal.
