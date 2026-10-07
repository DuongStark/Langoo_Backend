# DB3 — Import xếp hạng tần suất wordfreq (EN) · 2026-10-06

> Script: [`scripts/db3/wordfreq.ts`](../../scripts/db3/wordfreq.ts) + generator [`wordfreq-export.py`](../../scripts/db3/wordfreq-export.py)
> Nguồn: **wordfreq 3.1.1** (CC BY-SA 4.0) — bảng tần suất tính sẵn, **không dùng LLM**.
> Đã apply local (full DB 55433) và **VPS** (langoo). Mapping sha256: `c63037461c00dcaa691faa32b4a144d6e704eed1c75e8ff9a37292f7d33f61da`.

## 1. Kết quả

| Chỉ số | Giá trị |
| --- | --- |
| Lemma EN xuất từ DB | 1.409.228 (distinct lower) |
| Wordfreq EN khớp | **194.399** (từ vựng wordfreq: 321.180) |
| Lexeme EN cập nhật `frequency_rank` | **409.162** (nhiều bản ghi/lemma: wikt + wordnet) |
| Source row | `public.source#wordfreq`: version `3.1.1`, sha256 = mapping sha |

Mẫu: `run #313`, `cat #1727`, `apple #1795`; `runch`, `catex` (từ hiếm) → NULL.

## 2. Trước / sau (search EN)

| Query | Trước | Sau |
| --- | --- | --- |
| `cat` | cat×3, cate, cath, cats, catch… | cat×3, **catch, category, catholic, cats, categories, catching** |
| `run` | run×3, rune, rung, runn… | run×3, **running, runs, runner, runners** |
| `set` | set×3, seta, sets… | set×3, **setting, sets, settlement, settled, settle** |

Từ hiếm không có trong wordfreq vẫn hiện nhưng nằm cuối (NULL rank) — không cần filter thêm.

## 3. Cách chạy lại / rollback

```bash
# sinh mapping (venv có wordfreq):
python scripts/db3/wordfreq-export.py --lang en --lemmas en-lemmas.txt --out uploads/db3/wordfreq-en.tsv
# dry-run / apply:
npx tsx scripts/db3/wordfreq.ts --mapping uploads/db3/wordfreq-en.tsv
npx tsx scripts/db3/wordfreq.ts --mapping uploads/db3/wordfreq-en.tsv --apply --allow-db <db>
```

- Apply chỉ chạy khi toàn bộ rank của ngôn ngữ đang NULL (precondition ghi trong manifest).
- Manifest (local + VPS): `uploads/db3/2026-10-06T13-45-37-794Z-wordfreq.json` (VPS) / `…13-43-22…` (local).

## 4. Còn lại

- **JA**: wordfreq có tiếng Nhật nhưng cần match cả reading (coverage thấp hơn) — để đợt sau nếu cần.
- **Nghĩa nào phổ biến** (sense-level): chưa có dữ liệu; đề xuất nhóm subsense + hiển thị top theo thứ tự nguồn, AI-estimate (`DisplayPriority`) cho từ phổ biến về sau.

### 2026-10-06 — DB3-W1 — Khóa rollback wordfreq thiếu journal

Manifest wordfreq cũ chỉ có count/SHA, không ghi before/after theo lexeme.
`--rollback` hiện luôn từ chối trước kết nối DB; không xóa rank toàn ngôn ngữ.
Không chạy lại apply trong lần tích hợp M4.3. Muốn phục hồi run đã áp phải dùng
backup hoặc bổ sung journal per-row có guard drift/đúng target trước.
