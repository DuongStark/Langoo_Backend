# Sources API — danh sách nguồn dữ liệu cho màn credits · 2026-10-06

> Branch: `parallel/deepseek-search-sources` (commit `5cbe099` + follow-up) · Module: `src/sources/**` + đăng ký trong `src/app.module.ts`
> Đã deploy VPS (build lại + `pm2 restart langoo-api`), backup `src/app.module.ts.bak-20261006`.

## 1. Endpoint

```
GET /v1/sources        # public, không cần token
```

Trả `{ data: DataSourceDto[] }`, mỗi mục:

| Field | Ý nghĩa |
| --- | --- |
| `id`, `code`, `name` | định danh nguồn (`public.source`) |
| `license`, `attribution`, `url`, `version` | thông tin ghi nguồn |
| `credit_line` | dòng ghép sẵn: `Name — Attribution · License` |
| `child_count` | số nguồn con đã gộp (vd các lô DB3-B) |
| `usage` | số dòng đóng góp: `lexemes, senses, glosses, concepts, concept_glosses, kanji, examples` |

- **Cache 10 phút** trong process + **warm-up lúc boot** (request đầu không phải chờ COUNT bảng lớn).
- FE chỉ cần một màn "Nguồn dữ liệu": map `credit_line` + `url` + `usage` (có thể ẩn mục `usage` toàn 0 nếu muốn gọn).

## 2. Gộp nguồn DB3-B

DB3-B apply tạo **1 source/lô** (`db3b-ai-<jobKey>`, hiện 67 dòng). API gộp tất cả vào entry `llm-vi`
("Gloss tiếng Việt do LLM sinh", license `nội bộ`): cộng `usage.glosses`, `child_count = 1 + số lô`.
→ 18 mục nguồn sạch thay vì 84.

## 3. Số liệu VPS (sau deploy)

```
jmdict       lex=218794 gloss=443328 ex=32311
wiktextract  lex=1744214 gloss=2087593 ex=801242
oewn/omw-en/omw-ja  lex=161646/156584/94002
tatoeba      ex=2319079
llm-vi       child=67 gloss=6600 (tăng dần khi repair chạy)
```

Thời gian: cold ~7s (nếu cache nguội), warm 4–7ms; sau restart đã warm sẵn nên gần như tức thì.

## 4. Test & rollback

- `jest src/sources` 3/3 pass (map + cache + gộp DB3-B); eslint 0; build OK.
- Rollback: xoá `src/sources/`, khôi phục `src/app.module.ts.bak-20261006`, build lại + restart.

## 5. Việc FE (phiên khác)

Dựng màn "Nguồn dữ liệu / Ghi nguồn" gọi `GET /v1/sources`, render `credit_line` + link `url`, nhóm "đang dùng" theo `usage > 0`.
