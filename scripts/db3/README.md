# scripts/db3 — Seed dữ liệu nền DB3-A

Kế hoạch: [DB3-A](../../docs/plans/db3-a-foundation.md). Công cụ Node 22/TypeScript, không thêm dependency hay migration.

## Apply và rollback

- Mặc định dry-run: đọc nguồn/DB, ghi báo cáo JSON, không ghi dữ liệu DB.
- **Mọi thao tác ghi, kể cả rollback**, cần `--apply --allow-db <tên-db>`; DB `_test` cần thêm `--allow-test`.
- Manifest apply **format 2** ghi vào `uploads/db3/` (gitignored), quyền file `0600`. Ghi atomic + fsync: `planning` trước mutation, `prepared` chứa snapshot trước/sau trong transaction trước COMMIT, `applied` sau COMMIT.
- Một transaction cho cả run; lock bảng đích trong lúc chụp snapshot/ghi. Việc thêm source dùng chung lock `public.source` để tránh tranh `MAX(id)+1`. Lock quá 10 giây → dừng, rollback transaction.
- Rollback chỉ nhận manifest đúng task và đúng **host/port/database**, trạng thái `applied`. Từ chối manifest dry-run/legacy/aborted/đã rollback. Không lưu URL có user/password vào manifest.
- Rollback kiểm tra dữ liệu hiện tại khớp snapshot sau run; nếu đã có sửa tiếp thì dừng toàn bộ. Chỉ xoá dòng mới, khôi phục dòng cũ và metadata nguồn; giữ ID, bigint và timestamp đủ microsecond. Deck mới đã được user clone/tham chiếu không bị xoá.
- Khi COMMIT thành công nhưng cập nhật trạng thái cuối lỗi, file `prepared` đã chứa đủ dữ liệu phục hồi. Kiểm tra file rồi dùng rollback kèm **`--recover`** và đầy đủ guard; nếu DB không khớp after-state thì dừng. Rollback cũng ghi `rollback-prepared` trước khi khôi phục; nếu trạng thái cuối bị lỗi, `--recover` kiểm tra DB đã khôi phục hay chưa để hoàn tất an toàn. Không sửa tay trạng thái manifest để bỏ qua guard.
- Apply DB thật là bước vận hành riêng sau review; regression tự tạo DB local riêng, không reset DB của phiên hoặc gọi VPS/LLM.

## Chuẩn bị nguồn raw

Đặt vào `data-Langoo/downloads/extras/`, hoặc truyền `--sources <đường-dẫn-tuyệt-đối>`. Đường dẫn mặc định hỗ trợ repo chính và bố cục worktree `Langoo-worktrees/<phiên>`.

| File | Nguồn | Metadata |
| --- | --- | --- |
| `CJKRadicals.txt` | Unicode UCD | Unicode License v3 |
| `vi-kangxi-radicals.wikitext` | vi.wikipedia “Bộ thủ Khang Hi” | CC BY-SA, attribution |
| `unihan-kTotalStrokes.tsv` | `Unihan.zip`, `Unihan_IRGSources.txt`, trường `kTotalStrokes` | Unicode License v3 |
| `en-radicals-extracts.json` | Object `{ "Radical N": "intro extract" }`, 214 bài en.wikipedia | CC BY-SA, attribution |
| `kanjivg/` | Repo KanjiVG, `kanji/<codepoint>.svg` | CC BY-SA 3.0; pin release/tag/commit bằng `--version` |

Radical ghi hash, URL, license và version `raw-sha256` cho từng input, không hardcode ngày Wikipedia/phiên bản Unicode. Ops giữ raw snapshot và thông tin revision khi tải để có attribution/version cụ thể. Các license cũ còn cần xác minh được `credits-audit` báo lại, không tự thay.

## Tải nguồn raw (tuỳ chọn — một lệnh)

`fetch-sources` tải 4 nguồn chính + ghi `sources-manifest.json` (url/license/sha256); thêm `kanjivg` vào `--only` để tải luôn release SVG (cần `unzip` trong PATH):

```bash
npx tsx scripts/db3/fetch-sources.ts --out "/media/duongstark/Du lieu/langoo-db3-sources"
npx tsx scripts/db3/fetch-sources.ts --out <dir> --only cjk,vi,unihan,en,kanjivg
```

## Chạy

```bash
nvm use

# Parser, không cần DB
npx tsx scripts/db3/selftest.ts

# Regression: cần TEST_DIRECT_URL hoặc TEST_DATABASE_URL local *_test.
# Tự tạo DB mới, nạp dump/migration và xoá DB mới sau test.
node --import tsx --test scripts/db3/regression.test.ts
# Tuỳ chọn kiểm chứng raw 214 đầy đủ, vẫn chỉ ghi DB mới riêng:
DB3_TEST_RADICAL_SOURCES=/duong-dan/raw node --import tsx --test scripts/db3/regression.test.ts

# Thay đường dẫn và version bằng snapshot nguồn thực tế.
DB3_SOURCES=/duong-dan/data-Langoo/downloads/extras
npx tsx scripts/db3/radicals.ts --sources "$DB3_SOURCES"
npx tsx scripts/db3/kanjivg.ts --sources "$DB3_SOURCES" --version kanjivg-source-commit
npx tsx scripts/db3/decks.ts
npx tsx scripts/db3/verify-jlpt.ts
npx tsx scripts/db3/credits-audit.ts

# Apply fixture nhỏ explicit, chỉ DB local *_test.
npx tsx scripts/db3/radicals.ts --sources scripts/db3/fixtures/radicals --fixture --apply --allow-db langoo_parallel_deepseek_test --allow-test
npx tsx scripts/db3/kanjivg.ts --svg-dir scripts/db3/fixtures/kanjivg --version fixture --apply --allow-db langoo_parallel_deepseek_test --allow-test
npx tsx scripts/db3/decks.ts --apply --allow-db langoo_parallel_deepseek_test --allow-test --limit 5

# Rollback: thay file bằng manifest applied của đúng task/DB.
npx tsx scripts/db3/radicals.ts --rollback uploads/db3/run-radicals.json --apply --allow-db langoo_parallel_deepseek_test --allow-test
npx tsx scripts/db3/kanjivg.ts --rollback uploads/db3/run-kanjivg.json --apply --allow-db langoo_parallel_deepseek_test --allow-test
npx tsx scripts/db3/decks.ts --rollback uploads/db3/run-decks.json --apply --allow-db langoo_parallel_deepseek_test --allow-test
# Chỉ thêm --recover cho manifest prepared sau commit chưa được ghi trạng thái cuối.
```

## B0 — kiểm kê gloss/nguồn (DB3-B, read-only)

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/gloss-inventory.ts --manifest-dir uploads/db3b
```

Xuất `gloss-inventory` + `source-audit` JSON (fingerprint, phạm vi JLPT, coverage EN/VI theo sense, count rule §4.1, concept, EXPLAIN). Không ghi DB, không gọi provider. Kết quả snapshot 2026-10-05: [`docs/reviews/db3-b-inventory-2026-10-05.md`](../../docs/reviews/db3-b-inventory-2026-10-05.md).

## Gate dữ liệu và scope

- Radical apply thông thường cần đủ **214 số bộ duy nhất**, ký tự duy nhất, tên VI/EN và nghĩa VI không rỗng; input thiếu/parse lỗi dừng trước khi ghi. Số nét thiếu được giữ NULL và báo cáo theo plan. `--fixture` cho tập nhỏ chỉ trên DB local `_test` với `--allow-test`.
- KanjiVG apply cần `--version` và ít nhất một SVG khớp kanji. Báo cáo cả file không có kanji và kanji thiếu SVG. Thứ tự file cố định, không nhận SVG trùng codepoint, kiểm tra lại hash trước apply.
- `--copy-to <dir>` là cache file SVG ngoài DB: không overwrite file khác hash. Rollback chỉ phục hồi DB; cache file bất biến giữ lại cho ops/M14, không tự xoá file có thể đang được dùng.
- Deck: tạo/đồng bộ đủ 5 cấp, **N5 trước N1**, anchor primary sense; thiếu primary thì dừng. Chạy lại loại item rejected/đổi cấp/đổi primary, sửa position/item_count. Deck mới unpublished; deck hiện có giữ trạng thái publish và concept của anchor còn eligible. `--limit` chỉ trên DB local `_test` và **chỉ khi 5 slug seed chưa tồn tại**, để không thay deck đầy đủ bằng tập fixture.
- Radical báo cáo các KRADFILE part chưa khớp hoặc khớp nhiều bộ qua exact character/variants; không tự suy mapping giữa 214 bộ và 253 cấu kiện.
- API phục vụ ảnh KanjiVG thuộc **M14**; DB3-A chỉ seed metadata. DB3-B gloss/LLM và DB4 mapping không thuộc các script này.
