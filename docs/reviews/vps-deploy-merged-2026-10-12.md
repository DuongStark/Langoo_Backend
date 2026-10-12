# Deploy bản main đã merge lên VPS (12/10/2026)

> Trạng thái: **ĐÃ DEPLOY** (12/10/2026, build + `pm2 restart langoo-api`).
> Backup: `/opt/langoo/storage/backups/app-src-pre-merge-20261012.tar.gz`.

## Vì sao

- VPS đang chạy bản hand-merge **thiếu code scope hồ sơ (M6.2)**: tìm kiếm khi đăng
  nhập profile JA vẫn trả entry EN (tab "tự động" của FE lẫn EN).
- Bản main sau merge `5d6fc86` có đủ scope → deploy để hợp nhất VPS với main
  (43 file src lệch, gồm M6.2/M10.3/cursor v5…).

## Các bước

1. Backup src VPS (tar.gz, 596KB — thật ra src ~600KB nén).
2. Ghi ledger 2 migration đã tồn tại từ trước nhưng chưa ghi:
   `040_kanji_component.sql`, `041_english_learner_priority.sql`
   (objects đã có: `core.kanji_component` 43.634 row + 2 function english_*_hash).
3. `rsync -a --delete` src main → VPS (giữ file `.bak-*`; xóa orphan `vps-search.ts`).
4. `npm run build` + `pm2 restart langoo-api`.

## Smoke (localhost VPS)

| Test | Kết quả |
|---|---|
| ANON `search q=go` | en 16 + vi 2 + ja 2 (catalog công khai — đúng) |
| TOKEN JA-only `search q=go` | **ja 20 — KHÔNG còn en** |
| TOKEN JA-only `suggestions q=go` | ja 5 |
| Chi tiết lexeme EN: anon / token JA | 200 / **404 LEXEME_NOT_FOUND** |
| Reverse (mèo) | camelCase (`lexemeId`, `frequencyRank`, `senseHint`…) OK |
| `search q=走る` | 20 hits ja — không hồi quy |

Lưu ý FE: khi đăng nhập, search/suggest/detail cần gửi Bearer token để áp scope
(FE đang gửi — search_history có ghi). Từ ngoài hồ sơ (vd EN với profile JA) trả
404 ở detail — FE nên ẩn/không điều hướng. Reverse đã đổi snake_case → camelCase.

## Rollback

```bash
sudo tar xzf /opt/langoo/storage/backups/app-src-pre-merge-20261012.tar.gz -C /opt/langoo/app
sudo -u postgres psql langoo -c "DELETE FROM public.schema_migration WHERE name IN ('040_kanji_component.sql','041_english_learner_priority.sql')"
su - langoo -c "cd /opt/langoo/app && npm run build && pm2 restart langoo-api"
```
