# Ẩn ví dụ "rác" (quote đứt đoạn) trên API (11/10/2026)

> Trạng thái: **ĐÃ DEPLOY VPS** (11/10/2026, build + `pm2 restart langoo-api`).
> Code: [`sense-content.repository.ts`](../../src/dictionary/repositories/sense-content.repository.ts)
> (nhánh cũ: `sense-content.repository.ts.bak-20261011b`).

## 1. Vấn đề

Ví dụ EN đang hiển thị phần lớn từ **wiktextract — trích dẫn văn học bị cắt/elision**,
không phù hợp người học:

- `"so intent on this fantastic...narrative that she hardly stirred"- Walter de la Mare`
- `...catapulted Einstein to the pinnacle of fame`
- `argued … that foster homes are abusive`

Thống kê trên các ví dụ có gắn sense (đo trên toàn bảng):

| Ngôn ngữ | Chứa `[` hoặc `...` | Riêng EN thêm `…` |
|---|---|---|
| EN | ~46.953 | ~29.812 (chỉ 1.331 không có `[`/`...` → phần lớn đã bị bắt bởi quy tắc chính) |
| JA | 503 | — (giữ `…`) |
| VI | 1.051 | — (giữ `…`) |

## 2. Quy tắc lọc (chỉ ở tầng hiển thị, không xoá dữ liệu)

Trong `getExamples` (cả nhánh direct và nhánh link):

```sql
AND NOT (
  e.text LIKE '%[%' OR e.text LIKE '%...%'
  OR (e.language_id = 1 AND e.text LIKE '%…%')
)
```

- `[` / `...`: dấu hiệu chèn chú thích/elision — lọc mọi ngôn ngữ.
- `…`: chỉ lọc với EN (wiktextract dùng để đánh dấu cắt từ; JA/VI dùng `…`
  hợp lệ trong hội thoại nên giữ).
- Lọc trước `LIMIT` nên `examples` trả về chỉ chứa câu sạch.
- Không xoá/mark dữ liệu — có thể hoàn nguyên bằng rollback code.

## 3. Kiểm chứng (sau deploy)

- 3 sense junk-only (271866, 271867, 284742) → API trả **0 ví dụ** ✓
- 発条 132431 → vẫn 1 ví dụ (JA không hồi quy) ✓
- Sense Tatoeba EN mới (link `tatoeba_en_token_v1`) → vẫn hiện câu + bản dịch VI ✓
- Sense JA Tatoeba mới (142831) → vẫn hiện ✓
- tsc + eslint sạch; 49/49 test pass; build + restart OK.

## 4. Hạn chế

- Chỉ lọc dấu hiệu **truncation/elision**; quote cổ nhưng không cắt
  (`Put some run butter on the vegetables.`) vẫn hiển thị — không có dấu hiệu
  tự động để phân biệt.
- Sense chỉ toàn ví dụ rác sẽ hiện 0 ví dụ (nhất quán: câu hỏng còn tệ hơn không có).

## 5. Rollback

```bash
cp /opt/langoo/app/src/dictionary/repositories/sense-content.repository.ts.bak-20261011b \
   /opt/langoo/app/src/dictionary/repositories/sense-content.repository.ts
su - langoo -c "cd /opt/langoo/app && npm run build && pm2 restart langoo-api"
```
