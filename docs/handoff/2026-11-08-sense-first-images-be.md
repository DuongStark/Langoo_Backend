# Sense-first vocabulary images — BE implementation handoff

**Ngày:** 2026-11-08  
**Trạng thái:** Code + migration + docs đã commit; **chưa apply production**  
**Spec gốc:** [2026-11-08-sense-first-vocabulary-images.md](../plans/2026-11-08-sense-first-vocabulary-images.md)

---

## 1. Mục tiêu

Ảnh minh họa cho mỗi từ trong bộ từ vựng được gắn trực tiếp vào **sense** của từ, không phụ thuộc concept mapping. Giữ concept image cũ làm fallback.

Thứ tự resolve:

```text
sense image (mới) → concept image (cũ) → null
```

Inflection dùng ảnh root; no-image trả null.

---

## 2. File đã thay đổi

```text
db/migrations/049_sense_images.sql
db/ops/backfill-sense-media-pilot-20261108.sql
src/media/sense-image.repository.ts
src/media/sense-image.repository.spec.ts
docs/plans/2026-11-08-sense-first-vocabulary-images.md
docs/handoff/2026-11-08-sense-first-images-be.md
PROGRESS.md
```

Không sửa `core.concept_media`, `serve.concept_image`, logic mapping từ điển, hay `media_asset.kind`.

---

## 3. Thay đổi chính

### 3.1 `049_sense_images.sql`

- Tạo `core.sense_media`:
  - composite PK `(sense_id, asset_id)`
  - `status`, `is_primary`, `style_id`, `source`
  - review constraints giống `concept_media`
- Unique primary:
  - mỗi sense chỉ một ảnh `approved + is_primary`
- View `serve.sense_image`:
  - join `core.media_asset` với `kind='concept_image'`
  - chỉ trả `approved + is_primary`

### 3.2 Backfill pilot

`db/ops/backfill-sense-media-pilot-20261108.sql`:

- Lấy 100 ảnh pilot từ `core.media_asset` (`metadata.pilot=true`)
- Insert `core.sense_media` approved/primary
- Idempotent, `ON CONFLICT DO NOTHING`
- 13 ảnh concept cũ vẫn giữ; 87 ảnh unbound sẽ hiện qua sense sau backfill

### 3.3 Repository Tier 0

`src/media/sense-image.repository.ts` — `findSourcesWithDirectImages`:

- Thêm Tier 0 đọc `serve.sense_image`
- Ranking hiện tại `tier ASC` nên ảnh sense thắng concept
- Các Tier 1–3 concept giữ nguyên

### 3.4 Test

`src/media/sense-image.repository.spec.ts`:

- Assert SQL có `serve.sense_image` và `0 AS tier`
- Verification:
  - `npm test -- --runInBand src/media/sense-image.repository.spec.ts` → **4/4 pass**
  - `npm run build` → **pass**
  - Migration/backfill **chưa apply production**

---

## 4. Dữ liệu hiện tại

| Hạng mục | Số |
|---|---:|
| Pilot ảnh đã upload R2 + media_asset | 100 |
| Pilot đã bind concept cũ | 13 |
| Pilot chưa bind concept, chờ sense backfill | 87 |
| Tổng sense thiếu ảnh | 9.734 |
| Direct cần sinh ảnh | 9.144 |
| Prompt 8 ảnh | 1.144 |
| Inherit root | 9 |
| No-image skip | 581 |
| Dung lượng WebP 512 q75 ước tính | ~210MB |

100 ảnh pilot đúng thứ tự theo manifest (label đối chiếu item).

---

## 5. Thứ tự deploy

1. Review migration `049`.
2. Apply `049_sense_images.sql` qua migration ledger hiện tại.
3. Apply `backfill-sense-media-pilot-20261108.sql`.
4. Build/deploy backend có Tier 0.
5. Kiểm tra:
   - `manager` (sense 1811634) hiện ảnh
   - `政策` (sense 149550) hiện ảnh
   - `employee` (sense 373668) vẫn hiện
   - 13 concept image cũ không regression
6. Style test 64 ảnh trước khi chạy batch 9.144.

---

## 6. Lưu ý

- Migration chưa apply production trong commit này.
- Không dùng `prisma db push`; dùng ledger/migration hiện tại.
- Không chạy backfill trước migration.
- `media_asset.kind` vẫn là `concept_image`; `sense_media` quyết định ngữ nghĩa sense.
- Nếu sau này muốn `kind='sense_image'` riêng, làm migration riêng.
