# Sense-first vocabulary images — Backend implementation spec

**Ngày:** 2026-11-08  
**Trạng thái:** Draft for BE  
**Mục tiêu:** Cho phép mỗi từ trong bộ từ vựng có một ảnh minh họa theo đúng **sense được chọn trong deck**, không phụ thuộc concept mapping; vẫn giữ concept image cũ làm fallback.

---

## 0. TL;DR cho BE

Cần làm 4 việc:

1. Thêm bảng `core.sense_media` + view `serve.sense_image`.
2. Thêm **tier 0** vào `SenseImageRepository.findSourcesWithDirectImages`: ảnh theo sense được ưu tiên trước ảnh concept.
3. Backfill 100 ảnh pilot hiện có vào `sense_media`.
4. Giữ nguyên `serve.concept_image` và toàn bộ logic concept cũ; chỉ thêm fallback sense-first.

Không cần map concept cho 9.000+ từ. Không đổi dữ liệu từ điển.

---

## 1. Vấn đề hiện tại

Backend ảnh hiện chỉ đọc concept image:

```text
sense → concept exact/verified → concept_media approved primary → ảnh
```

Vì vậy nhiều từ có nghĩa/gloss nhưng không hiện ảnh:

- `manager` (sense `1811634`): có concept ứng viên, nhưng `deck_item.concept_id = NULL`, không có `sense_concept` exact.
- `政策` (sense `149550`): `sense.definition = NULL`, `deck_item.concept_id = NULL`; chỉ có gloss `political measures`.
- `申し込み` (sense `37858`): `definition = NULL`, `deck_item.concept_id = NULL`; có nhiều concept ứng viên khác nghĩa (signing / proposal / request).

Trong 100 ảnh pilot:

| Tầng | Số lượng |
|---|---:|
| Có concept candidate theo lemma/POS | 100/100 |
| `deck_item.concept_id` non-null | 36/100 |
| `sense_concept` exact/verified cho anchor | 9/100 |
| Ảnh bind được vào concept image | 13/100 |

87 ảnh còn lại đã có file R2 + row `media_asset`, nhưng `serve.concept_image` không trả vì thiếu cầu nối concept.

**Kết luận:** concept không thiếu ở tầng từ điển; nhưng concept mapping exact cho từng sense/deck thì thiếu. Với mục tiêu “mỗi từ một ảnh cho nghĩa chính”, concept mapping là tầng không cần thiết.

---

## 2. Thiết kế đề xuất: sense-first hybrid

### Thứ tự resolve ảnh

```text
1. Ảnh trực tiếp theo sense_id       ← mới, ưu tiên
2. Nếu là inflection → ảnh sense gốc ← tái sử dụng logic root hiện có
3. Ảnh concept exact/verified cũ     ← fallback, giữ nguyên
4. null
```

### Nguyên tắc dữ liệu

- Mỗi từ trong deck dùng `core.deck_item.anchor_sense_id` làm **nghĩa chính**.
- Một sense chỉ có một ảnh `approved + is_primary`.
- Ảnh sense không cần `concept_id`, không cần `concept_media`.
- Inflected forms (past/plural/gerund…) không tạo ảnh riêng; dùng ảnh root.
- Sense thuộc nhóm no-image (trợ động từ/ngữ pháp/trừu tượng) không tạo ảnh.
- Tiếng Nhật: lấy nghĩa từ `core.sense.definition` nếu có, fallback `core.sense_gloss` (EN/VI).

---

## 3. Database migration

Tên gợi ý: `049_sense_images.sql` (theo ledger `public.schema_migration` hiện tại; `047` và `048` đã dùng).

### 3.1 Bảng `core.sense_media`

```sql
CREATE TABLE core.sense_media (
  sense_id     bigint NOT NULL REFERENCES core.sense(id) ON DELETE CASCADE,
  asset_id     bigint NOT NULL REFERENCES core.media_asset(id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  is_primary   boolean NOT NULL DEFAULT false,
  style_id     text,
  source       text NOT NULL DEFAULT 'vocab-batch' CHECK (btrim(source) <> ''),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by_label text CHECK (reviewed_by_label IS NULL OR btrim(reviewed_by_label) <> ''),
  PRIMARY KEY (sense_id, asset_id),
  CONSTRAINT sense_media_review_pair CHECK ((reviewed_at IS NULL) = (reviewed_by_label IS NULL)),
  CONSTRAINT sense_media_approved_review CHECK (status <> 'approved' OR reviewed_at IS NOT NULL),
  CONSTRAINT sense_media_primary_approved CHECK (NOT is_primary OR status = 'approved')
);

CREATE UNIQUE INDEX sense_media_one_primary
  ON core.sense_media (sense_id)
  WHERE is_primary AND status = 'approved';
CREATE INDEX sense_media_asset ON core.sense_media (asset_id);
```

Không cần đổi constraint `media_asset_kind_check`.
Ảnh sense dùng `core.media_asset.kind = 'concept_image'` (kind hiện tại đã cho phép `image/webp`); ngữ nghĩa sense nằm ở bảng `sense_media`.

### 3.2 View `serve.sense_image`

```sql
CREATE OR REPLACE VIEW serve.sense_image AS
SELECT
  sm.sense_id,
  sm.asset_id,
  sm.style_id,
  sm.source,
  ma.object_key,
  ma.mime,
  ma.bytes,
  ma.sha256,
  ma.provider
FROM core.sense_media sm
JOIN core.media_asset ma ON ma.id = sm.asset_id
WHERE sm.status = 'approved'
  AND sm.is_primary
  AND ma.mime IN ('image/webp', 'image/png', 'image/jpeg');
```

Grant quyền giống `serve.concept_image` cho role app đang dùng.

### 3.3 Backfill 100 ảnh pilot

100 ảnh pilot đã có trong `core.media_asset` với metadata:

```json
{
  "pilot": true,
  "source_sense_id": "1811634",
  "style": "realistic-v3",
  "source_definition_kind": "sense_definition"
}
```

Backfill:

```sql
INSERT INTO core.sense_media
  (sense_id, asset_id, status, is_primary, style_id, source, reviewed_at, reviewed_by_label)
SELECT DISTINCT ON ((ma.metadata->>'source_sense_id')::bigint)
  (ma.metadata->>'source_sense_id')::bigint,
  ma.id,
  'approved',
  true,
  COALESCE(ma.metadata->>'style', 'realistic-v3'),
  'pilot',
  now(),
  'project-owner:pilot-antislop-2026-11-08'
FROM core.media_asset ma
WHERE ma.metadata->>'pilot' = 'true'
  AND ma.metadata->>'source_sense_id' ~ '^[0-9]+$'
ORDER BY (ma.metadata->>'source_sense_id')::bigint, ma.id
ON CONFLICT (sense_id, asset_id) DO NOTHING;
```

Sau backfill:

- 100 sense có ảnh sense-level.
- 13 ảnh vẫn giữ concept_media cũ.
- API trả được cả 100 ảnh.

---

## 4. Backend code changes

### 4.1 Repository — thêm tier 0

File: `src/media/sense-image.repository.ts`  
Hàm: `findSourcesWithDirectImages`

Thêm nhánh **tier 0** vào đầu CTE `candidates`, trước Tier 1 hiện tại:

```sql
-- Tier 0: sense-level image (mới)
SELECT
  rs.sense_id,
  0 AS tier,
  1.0::real AS confidence,
  ssi.asset_id,
  NULL::bigint AS concept_id,
  NULL::bigint AS anchor_sense_id,
  ssi.object_key,
  ssi.mime,
  ssi.bytes,
  ssi.sha256,
  ssi.provider,
  ma.metadata
FROM requested_senses rs
JOIN serve.sense_image ssi ON ssi.sense_id = rs.sense_id
JOIN core.media_asset ma ON ma.id = ssi.asset_id

UNION ALL

-- Tier 1..3: giữ nguyên logic concept hiện tại
...
```

Ranking hiện tại đã là `ORDER BY tier ASC, ...`, nên ảnh sense sẽ thắng ảnh concept.

`DirectCandidateSqlRow` đã cho phép `concept_id`/`anchor_sense_id` nullable; không cần đổi type.

### 4.2 Service

File: `src/media/sense-image.service.ts`

Không cần đổi luồng chính:

- `classifyImageSource()` vẫn quyết định `direct / inflection / no_image`.
- `direct` → `directCandidate` (giờ có thể đến từ tier 0).
- `inflection` → root fallback; `findDirectImages(targetRootIds)` cũng tự động dùng tier 0.
- `no_image` → null.

Chỉ cần đảm bảo `findDirectImages()` dùng chung `findSourcesWithDirectImages()` (hiện tại đúng).

### 4.3 Response type (optional)

Nếu FE cần hiển thị style, thêm field optional, không breaking:

```ts
export interface ImageContract {
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  styleId?: string | null; // optional
}
```

Nếu chưa cần, bỏ qua.

---

## 5. Hợp đồng dữ liệu cho pipeline sinh ảnh

Pipeline (native Muse / batch) insert:

### 5.1 `core.media_asset`

Giữ `kind = 'concept_image'` (legacy storage kind).

Metadata bắt buộc:

```json
{
  "source_sense_id": "1811634",
  "source_lemma": "manager",
  "source_language_id": 1,
  "source_pos": "noun",
  "source_definition": "A person whose job is to manage something...",
  "source_definition_kind": "sense_definition",
  "source_definition_sha256": "...",
  "prompt_version": "vocab-square-512-webp75-antislop-v3",
  "prompt_sha256": "...",
  "prompt_text": "...",
  "prompt_id": "prompts-direct-ready-en-0150",
  "style": "realistic-v3",
  "pilot": true,
  "width": 512,
  "height": 512,
  "rights_policy": "provider_terms_not_CC0"
}
```

R2 key:

```text
illustrations/<prompt_version>/<sha256>.webp
```

### 5.2 `core.sense_media`

Mỗi ảnh:

```sql
INSERT INTO core.sense_media
  (sense_id, asset_id, status, is_primary, style_id, source, reviewed_at, reviewed_by_label)
VALUES ($sense_id, $asset_id, 'approved', true, $style_id, 'vocab-batch', now(), 'project-owner:batch')
ON CONFLICT (sense_id, asset_id) DO NOTHING;
```

Chỉ set `is_primary = true` nếu sense chưa có primary approved.

### 5.3 Nguồn nghĩa

```sql
COALESCE(
  NULLIF(trim(s.definition), ''),
  NULLIF(trim(en_gloss), ''),
  NULLIF(trim(vi_gloss), '')
) AS source_definition
```

- EN: thường có `s.definition`.
- JA: nhiều sense `s.definition = NULL`; dùng `core.sense_gloss` EN/VI.
- 228 sense JA không có gloss → skip/no-image.
- Không dùng definition của sense khác nếu không đúng nghĩa.

### 5.4 Phạm vi sinh ảnh

- Một ảnh cho mỗi **anchor sense** của deck.
- Dedupe theo `sense_id` khi cùng từ nằm nhiều deck.
- Inflected forms: không sinh; dùng ảnh root.
- No-image: bỏ.
- Số liệu hiện tại:
  - 9.734 sense thiếu ảnh
  - 9.144 direct cần sinh
  - 1.144 prompt (8 ảnh/prompt)
  - 9 inherit root
  - 581 no-image
  - ~210MB WebP 512 q75

### 5.5 Style

8 style, random **theo prompt**:

```text
realistic, cartoon, handdrawn, watercolor, flatvector, comic, clay, minimal
```

- `style_id` lưu ở `sense_media.style_id` và `media_asset.metadata.style`.
- Mỗi prompt 8 từ cùng style; style phân bổ đều, tránh lặp liền kề.
- Global constraint: vuông 512, đúng nghĩa, nền đơn giản, không chữ/watermark/collage, tránh AI slop.

---

## 6. API behavior

`SenseImageService.resolveMany(ids)` sau thay đổi:

| Trường hợp | Kết quả |
|---|---|
| Sense có ảnh sense-level | Trả ảnh sense (tier 0) |
| Sense direct, không có ảnh sense, có concept | Trả concept fallback |
| Sense inflection, có root sense ảnh | Trả ảnh root |
| Sense inflection, root không có ảnh | null |
| Sense no-image | null |
| Concept image cũ | Vẫn hoạt động như trước |

Không thay đổi endpoint/response shape ngoài field `styleId` optional.

---

## 7. Test / Acceptance criteria

### Unit / repository

- [ ] Tier 0 thắng tier 1–3 khi cùng sense có cả sense image và concept image.
- [ ] Fallback concept vẫn hoạt động khi không có sense image.
- [ ] Inflection resolve root sense và lấy ảnh sense root.
- [ ] `no_image` trả null.
- [ ] `resolveMany` batch 100/1.000 ids không N+1.

### Migration / data

- [ ] Migration `049` chạy trong transaction, không đổi bảng concept.
- [ ] `serve.sense_image` trả đúng `approved + is_primary`.
- [ ] Unique index chặn 2 primary approved/sense.
- [ ] Backfill đủ 100 ảnh pilot.
- [ ] `manager` (1811634), `政策` (149550) trả ảnh sau khi có sense_media.
- [ ] `employee` (373668) vẫn trả ảnh; concept image cũ không regression.
- [ ] 13 ảnh concept cũ vẫn hoạt động.

### API / app

- [ ] 100 ảnh pilot hiện trong app qua sense.
- [ ] Từ inflected (`boxes`, `running`...) dùng ảnh root, không cần ảnh riêng.
- [ ] Từ no-image không trả ảnh.
- [ ] WebP URL trả `content-type: image/webp`, hash/length đúng.

---

## 8. Rollout

### Phase 0 — Migration + 100 pilot

1. Tạo `049_sense_images.sql`.
2. Chạy migration.
3. Backfill 100 ảnh pilot.
4. Deploy repository tier 0.
5. Check 100 ảnh trong app + 13 concept cũ.

### Phase 1 — Style test

- 8 style × 8 từ = 64 ảnh.
- Nén 512 WebP q75.
- Review style trước khi scale.

### Phase 2 — Full

- Sinh 9.144 ảnh / 1.144 prompt.
- Upload R2 + `media_asset` + `sense_media`.
- Checkpoint/resume; idempotent theo `sha256/object_key`.
- Ước tính 6–16h tùy worker.

### Phase 3 — QA

- Sample visual review.
- Check style distribution.
- Check missing/failed; retry.
- Không có ảnh local; mọi ảnh ở R2.

---

## 9. Non-goals / lưu ý

- **Không xoá** `core.concept_media` / `serve.concept_image`.
- **Không** tạo mapping `sense_concept` mới trong phase này.
- **Không** sửa nghĩa từ điển.
- **Không** sinh ảnh cho inflection/no-image.
- Không đổi `media_asset.kind`; dùng `concept_image` + `sense_media`.
- Nếu sau này muốn kind `sense_image`, làm migration riêng; hiện tại không cần.

---

## 10. Ví dụ dữ liệu thật

### `manager` — sense 1811634

```text
deck en-office-work: concept_id = NULL
concept candidates: 105483 (sports coach), 106026 (controls resources)
pilot asset: 6582, mime image/webp, source_sense_id 1811634
```

Sau migration:

```sql
INSERT INTO core.sense_media(sense_id, asset_id, status, is_primary, style_id, source)
VALUES (1811634, 6582, 'approved', true, 'realistic-v3', 'pilot');
```

API trả ảnh qua sense; không cần concept.

### `政策` — sense 149550

```text
definition = NULL
gloss_en = political measures
pilot asset: 6651
```

Sau migration: sense_media (149550, 6651) → API trả ảnh.

### `employee` — sense 373668

```text
concept 106262 (curated)
concept_media approved primary (asset 6587)
```

Sau migration vẫn hiện; tier 0 và tier 1 cùng trỏ một ảnh, không conflict.

---

## 11. Open questions

1. Có cần trả `styleId` trong API response không? (optional)
2. Review policy cho batch mới: auto-approve hay pending? Đề xuất pilot auto-approve, batch lớn có sample review.
3. Có cần ảnh alternate/gallery mỗi sense không? Phase này chỉ primary.
4. Có cần thêm `sense_image` kind riêng không? Đề xuất không, để giảm migration.

---

## 12. File/commit đề xuất

```text
db/migrations/049_sense_images.sql
src/media/sense-image.repository.ts   # thêm tier 0
src/media/sense-image.service.ts      # giữ nguyên logic, optional styleId
src/media/types/image.types.ts        # optional styleId
test/media-image-delivery.e2e-spec.ts # thêm case manager/policy
scripts/media/backfill-sense-media.mjs (optional CLI)
```

Migration phải được review và chạy qua `apply-schema.mjs`/ledger hiện tại, không dùng `prisma db push`.

---

## 13. Implementation log — 2026-11-08

Đã implement trên backend VPS:

- `db/migrations/049_sense_images.sql`
  - bảng `core.sense_media` (composite PK `sense_id, asset_id`)
  - unique primary approved/sense
  - view `serve.sense_image`
- `db/ops/backfill-sense-media-pilot-20261108.sql`
  - backfill 100 ảnh pilot hiện có từ `media_asset.metadata.pilot=true`
- `src/media/sense-image.repository.ts`
  - thêm **Tier 0** đọc `serve.sense_image` trước Tier 1–3 concept
- `src/media/sense-image.repository.spec.ts`
  - test SQL có `serve.sense_image` và `0 AS tier`
- Verification:
  - `npm test -- --runInBand src/media/sense-image.repository.spec.ts` → **4/4 pass**
  - `npm run build` → **pass**
  - Migration/backfill **chưa apply production**
- `docs/plans/2026-11-08-sense-first-vocabulary-images.md`
  - spec này

Dữ liệu pilot hiện tại:

- 100 ảnh đã upload R2 + `media_asset`.
- 13 ảnh EN đã bind concept cũ.
- 87 ảnh chưa bind concept; sau migration/backfill sẽ hiện qua sense.
- 100/100 ảnh đúng thứ tự theo manifest.

Chưa apply migration/backfill lên production trong bước code này. Thứ tự deploy:

1. Review + apply `049_sense_images.sql`.
2. Apply `backfill-sense-media-pilot-20261108.sql`.
3. Build/deploy backend có Tier 0.
4. Kiểm tra 100 ảnh pilot trong app.
5. Style test 64 ảnh → batch 9.144 ảnh.
