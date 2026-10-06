# scripts/db3 — Dữ liệu nền DB3-A và gloss DB3-B

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

## B1 — harvest candidate gloss (DB3-B, read-only)

```bash
# Cần artifact B0 (inventory + source-audit) trong --artifact-dir.
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/gloss-harvest.ts --artifact-dir uploads/db3b
# Kiểm chứng: parse + recompute hash toàn bộ JSONL
npx tsx scripts/db3/gloss-harvest.ts --verify uploads/db3b/harvest-<stamp>
```

Xuất `candidates.jsonl` (needs_translation) + `unresolved.jsonl` (ambiguous/blocked_source/missing_context) theo contract v1 ([schema v1](../../docs/plans/db3-b-schema-v1.md)). Kết quả 2026-10-05: [`docs/reviews/db3-b-harvest-2026-10-05.md`](../../docs/reviews/db3-b-harvest-2026-10-05.md).

## B2 — dịch, review, apply và rollback gloss

Node 22. [Báo cáo B2](../../docs/reviews/db3-b-tooling-2026-10-05.md) ghi phạm vi và kiểm thử; [contract example v1](../../docs/plans/db3-b-example-schema-v1.md) dành cho DeepSeek harvest Tatoeba, chỉ xuất artifact.

Thư mục artifact phải chứa inventory/source-audit B0 và JSONL B1 đúng hash. Truyền đường dẫn tương đối với `--artifact-dir`; tool từ chối traversal và symlink. Trên VPS dùng `/opt/langoo/storage/db3b/` ngoài thư mục release, backup cả artifact và DB. Các lệnh dưới là hướng dẫn; apply VPS cần gate B3/B4 trong plan.

```bash
nvm use
DB3B_ARTIFACT_DIR=/duong-dan/storage/db3b
DB3B_CANDIDATES=harvest-<stamp>/candidates.jsonl
DB3B_INVENTORY=<stamp>-gloss-inventory.json

# Dry-run mặc định: không ghi artifact, không gọi provider hoặc DB.
# Chọn 100 sense JA duy nhất, ưu tiên N5, ít nhất 10 ca đa nghĩa.
npx tsx scripts/db3/gloss-translate.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --inventory "$DB3B_INVENTORY" --dry-run

# Stub: gloss VI do fixture cung cấp, map semanticKey -> string/null.
# --max-targets <100 chỉ dùng kiểm tra nhỏ, không đạt gate pilot.
npx tsx scripts/db3/gloss-translate.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --inventory "$DB3B_INVENTORY" --job stub-job.json --provider stub --stub-outputs stub-outputs.json --max-targets 2 --generate

# B3 chỉ chạy sau khi key mới, model/pricing/budget và policy đã kiểm tra.
# DB3_AI_* dùng cấu hình §5.1 plan, tách khỏi AI_* runtime chat.
# Cần --generate explicit; không tự chuyển model khi lỗi/hết quota.
npx tsx scripts/db3/gloss-translate.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --inventory "$DB3B_INVENTORY" --job pilot-job.json --provider opencode-go --generate

# Xuất 100 output non-null đã qua validator, kèm JA/EN/source cho người review.
npx tsx scripts/db3/gloss-review.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --job pilot-job.json
# Copy reviews/<jobKey>-template.json thành review.json rồi review đủ 100 dòng.
# Template mặc định fail/UNREVIEWED, không tự approve, không overwrite file cũ.

# Kiểm tra shape job, không ghi DB.
npx tsx scripts/db3/gloss-apply.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --job pilot-job.json --dry-run
# Chỉ sau gate review ngữ nghĩa >=98/100 pass, 0 severe; chỉ dòng pass được apply.
# Quyết định 06/10 cho phép GPT review pilot; reviewer phải ghi rõ AI.
# DIRECT_URL phải trỏ đúng host/port/database của job snapshot.
npx tsx scripts/db3/gloss-apply.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --job pilot-job.json --review review.json --apply --allow-db <database>
npx tsx scripts/db3/verify-gloss.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --job pilot-job.json
# Rollback cần cùng --job/--rollback và guard DB, theo thứ tự child ngược.
npx tsx scripts/db3/gloss-apply.ts --artifact-dir "$DB3B_ARTIFACT_DIR" --candidates "$DB3B_CANDIDATES" --job pilot-job.json --rollback pilot-job.json --apply --allow-db <database>
```

- Muse pilot dùng Responses API, `reasoning.effort=minimal`, concurrency 1, không chấp nhận cấu hình khác rồi âm thầm bỏ qua. Space Bunny là lựa chọn dự phòng explicit; LongCat đã loại theo bench trong plan. Kiểm tra giá/model trước B3: policy giá trong tool không phải cap billing của provider.
- Ghi intent và budget reservation trước request. Cache theo input/model/prompt/protocol, response/intent theo jobKey; resume kiểm tra hash, output và checkpoint trước khi dùng lại. Request timeout hoặc crash thiếu response trở thành `unknown`, giữ reservation; cần `--retry-unknown` explicit, có thể phát sinh tính phí lần nữa. Request đã hoàn tất có response bền vững được phục hồi mà không gọi lại. Tối đa 3 attempt/target, mọi attempt tính vào cap; Retry-After >30s dừng để resume sau.
- Lỗi khóa `job.lock`: kiểm tra PID và tiến trình đang chạy trước khi xử lý lock cũ. Không sửa checkpoint để bỏ qua budget/gate. Nếu thiếu/sai hash response hoặc journal thì dừng và khôi phục từ backup.
- Apply append lô 50, kiểm tra lại target/context/source/forms/JLPT trong transaction; không overwrite reviewed, không promote concept/cache/mapping. Mọi output LLM vẫn `is_machine=true`, `quality/reviewed_by/reviewed_at=NULL`; pilot review gate không đồng nghĩa curator đã duyệt từng dòng DB. GPT review được chủ dự án chấp nhận cho pilot ngày 06/10; ghi reviewer AI trong artifact, giữ ngưỡng chất lượng và hash binding. [Pilot gốc](../../docs/reviews/db3-b-pilot-2026-10-06.md) chưa đạt gate.
- Child được đăng ký trước mutation. Resume đối chiếu journal prepared/applied và DB; rollback giữ source/import_batch/mapping_run và history, đánh dấu run rolled_back. Nếu curator đã sửa hoặc job khác còn dùng lại gloss, rollback dừng. Rollback job phụ thuộc trước rồi job sở hữu gloss; job đã rollback không tự reapply.
- B2 hiện nhận job dịch `needs_translation` cho sense/concept. `eligible_source` trực tiếp và `concept_label` cần contract/job riêng khi có candidate đủ điều kiện; B1 hiện có 0 eligible_source, OMW lemma bị blocked. Example chưa seed DB. FE badge/credits và curation vẫn là gate rollout.

Kiểm thử offline và DB UUID mới riêng:

```bash
node --import tsx --test scripts/db3/gloss-types.test.ts scripts/db3/example-types.test.ts scripts/db3/gloss-translate.test.ts
# Cần TEST_DIRECT_URL hoặc TEST_DATABASE_URL local *_test.
node --import tsx --test scripts/db3/gloss-apply.test.ts
# Regression chung DB3-A khi thay _mutations.ts.
node --import tsx --test scripts/db3/regression.test.ts
npx tsc --noEmit --strict --target ES2023 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck scripts/db3/*.ts
```
## B1 — harvest cặp ví dụ Tatoeba (DB3-B, read-only)

```bash
DIRECT_URL="postgresql://postgres@127.0.0.1:55433/langoo" \
npx tsx scripts/db3/example-candidates.ts --artifact-dir uploads/db3b
# Kiểm chứng:
npx tsx scripts/db3/example-candidates.ts --verify uploads/db3b/examples-<stamp>
```

Xuất `examples.jsonl` theo example schema v1 ([contract](../../docs/plans/db3-b-example-schema-v1.md)): 8.477 cặp JA↔VI, `alignment=unmapped`, giữ lineage sentence/link; **không** gán sense/seed. Kết quả 2026-10-05: [`docs/reviews/db3-b-example-candidates-2026-10-05.md`](../../docs/reviews/db3-b-example-candidates-2026-10-05.md).

## Gate dữ liệu và scope

- Radical apply thông thường cần đủ **214 số bộ duy nhất**, ký tự duy nhất, tên VI/EN và nghĩa VI không rỗng; input thiếu/parse lỗi dừng trước khi ghi. Số nét thiếu được giữ NULL và báo cáo theo plan. `--fixture` cho tập nhỏ chỉ trên DB local `_test` với `--allow-test`.
- KanjiVG apply cần `--version` và ít nhất một SVG khớp kanji. Báo cáo cả file không có kanji và kanji thiếu SVG. Thứ tự file cố định, không nhận SVG trùng codepoint, kiểm tra lại hash trước apply.
- `--copy-to <dir>` là cache file SVG ngoài DB: không overwrite file khác hash. Rollback chỉ phục hồi DB; cache file bất biến giữ lại cho ops/M14, không tự xoá file có thể đang được dùng.
- Deck: tạo/đồng bộ đủ 5 cấp, **N5 trước N1**, anchor primary sense; thiếu primary thì dừng. Chạy lại loại item rejected/đổi cấp/đổi primary, sửa position/item_count. Deck mới unpublished; deck hiện có giữ trạng thái publish và concept của anchor còn eligible. `--limit` chỉ trên DB local `_test` và **chỉ khi 5 slug seed chưa tồn tại**, để không thay deck đầy đủ bằng tập fixture.
- Radical báo cáo các KRADFILE part chưa khớp hoặc khớp nhiều bộ qua exact character/variants; không tự suy mapping giữa 214 bộ và 253 cấu kiện.
- API phục vụ ảnh KanjiVG thuộc **M14**; DB3-A chỉ seed metadata. DB3-B gloss/LLM và DB4 mapping không thuộc các script này.
