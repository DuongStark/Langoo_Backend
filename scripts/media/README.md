# M14.1 — Lưu ảnh Muse trên R2 và liên kết concept

CLI vận hành cho 4 ảnh prompt C và 40 ảnh lô 1–2, Node 22.22.2. Không thay API/FE hoặc storage feedback.
Mọi lần apply DB/migration mới phải nằm trong phạm vi chủ dự án đã duyệt.

## Local: kiểm ảnh và upload

Credentials ở `~/.config/langoo/r2.env` (0600, parent 0700), ngoài repo; xem
[setup](../../docs/handoff/m14.1-cloudflare-r2-setup-2026-10-30.md).
Không đưa secret vào arguments, receipt, Git hoặc VPS. Cần pg/dotenv sẵn có của app;
SDK upload và PGlite test dùng runtime riêng, không đổi dependencies app:

```sh
npm install --prefix /tmp/langoo-m141-r2-probe --no-audit --no-fund @aws-sdk/client-s3@3.1160.0 @electric-sql/pglite@0.5.13
node --test scripts/media/*.test.mjs
node scripts/media/r2-upload.mjs uploads/docs3-muse-images-20261030-batch3/manifest.json uploads/m14.1/check.json
node scripts/media/r2-upload.mjs uploads/docs3-muse-images-20261030-batch3/manifest.json uploads/m14.1/r2-upload-final.json --apply
```

Có thể đổi runtime SDK bằng `M141_SDK_ROOT`. Profile mặc định `phone-c`: manifest phải là array, có variant C,
`file`, `sense_id`, `definition`, `image_prompt`, `sha256`; chỉ file PNG C cùng thư mục.
Key bất biến theo hash. PUT có điều kiện; GET S3 và public URL đều phải đúng hash.
Rerun kiểm object hiện có, không PUT lại. Receipt ghi từng bước trước/sau PUT;
nếu lỗi giữ object và receipt để chạy lại, không tự xóa hoặc tự đổi review state.
Crash có thể để lại `.lock`; chỉ gỡ lock khi đã xác nhận process cũ dừng.
Receipt local chứa prompt/definition nhưng không có credentials; không upload receipt lên bucket public.

## VPS: migration chính xác và đăng ký

Không chuyển ảnh hoặc R2 credentials lên VPS. Chỉ chép các file nhỏ sau vào cùng thư mục:
`images.mjs`, `register.mjs`, `apply-schema.mjs`, `045_concept_images.sql`.
Dùng `M141_APP_ROOT=/opt/langoo/app` để đọc `.env` và dependencies có sẵn trên VPS.
Không dùng migrator all-pending hoặc Prisma migrate/db push cho schema core.

```sh
# Dry-run: receipt qua stdin, không ghi DB; kiểm lại public bytes và nghĩa nguồn.
ssh langoo-vps 'M141_APP_ROOT=/opt/langoo/app node /tmp/m141-media/register.mjs' < uploads/m14.1/r2-upload-final.json
# Chỉ sau duyệt migration và kiểm hash file đã review:
ssh langoo-vps 'M141_APP_ROOT=/opt/langoo/app node /tmp/m141-media/apply-schema.mjs /tmp/m141-media/045_concept_images.sql <SHA256_DA_REVIEW> --apply'
ssh langoo-vps 'M141_APP_ROOT=/opt/langoo/app node /tmp/m141-media/register.mjs --apply' < uploads/m14.1/r2-upload-final.json
```

Registrar giới hạn bucket `langoo-image`, public base `https://media.langoo.org`, version
các version trong bảng profile bên dưới, tối đa 20 asset mỗi receipt; đây là importer có phạm vi hữu hạn.
Mỗi transaction đọc lại definition/hash và mapping có khóa; sai nghĩa thì rollback toàn bộ.
Thiếu mapping vẫn lưu asset, không tạo concept; concept draft giữ pending; curated mới approved.
Không đè primary/review hiện có. Rerun giữ asset và trạng thái trước đó.
`model_revision=null` vì Muse web không cung cấp model revision đáng tin cậy;
provenance không có nghĩa ảnh là CC0 hoặc bảo đảm tuyệt đối về quyền sử dụng.

## Gắn ảnh mặc định dùng theo yêu cầu follow-up

Chủ dự án đã yêu cầu gắn hết bốn ảnh C, bỏ pre-review concept. Sau migration 046,
`bind-existing.mjs` dùng binding đã chỉ định rõ ở `pilot-c-bindings.json`:

```sh
ssh langoo-vps 'M141_APP_ROOT=/opt/langoo/app node /tmp/m141-media/bind-existing.mjs /tmp/m141-media/pilot-c-bindings.json' < uploads/m14.1/r2-upload-final.json
ssh langoo-vps 'M141_APP_ROOT=/opt/langoo/app node /tmp/m141-media/bind-existing.mjs /tmp/m141-media/pilot-c-bindings.json --apply' < uploads/m14.1/r2-upload-final.json
```

Chép thêm `bind-existing.mjs`, binding JSON và migration 046 vào thư mục CLI VPS.
Áp 046 bằng `apply-schema.mjs` + hash file đã review như 045; yêu cầu 045 đã có ledger.
Binding CLI kiểm lại public hash/receipt, asset nguồn, definition nguồn/anchor và mapping hiện tại;
cho ảnh của concept draft dùng được mà không đổi concept status. Không tạo sense_concept mới.
Có thể dùng một anchor khác nguồn sinh ảnh khi definition/POS tương đương đã được đối chiếu rõ:
breakfast dùng anchor 300487; spicy dùng 604192. Original source vẫn giữ trong asset metadata.
Ảnh pending trong batch được cho dùng thì chuyển approved; approved/rejected và primary cũ được bảo vệ.
`register.mjs` ban đầu vẫn giữ logic import bảo thủ; bước explicit binding là nơi áp chính sách
mặc định dùng cho ảnh được chọn, không tự approve mọi pending asset khi rerun registrar.

## Contract đọc

Dùng `serve.concept_image` (chỉ approved primary, concept draft/curated và mapping hiện còn exact,
verified, confidence ≥ 0.7). View trả `concept_id`, `asset_id`, `anchor_sense_id`, `object_key`,
`mime`, `bytes`, `sha256`, `provider`. Dựng URL từ public base cấu hình + `/` + object key.
Không trả pending asset từ `core.media_asset` trực tiếp cho học viên.
API/FE chưa được tích hợp trong M14.1 pilot này.

## Gắn thêm 40 ảnh đã tạo ở lô 1–2

Chủ dự án yêu cầu toàn bộ 40 ảnh trước. Không cần migration mới hoặc gọi Muse.
Uploader chọn profile tường minh để giữ provenance đúng; không đổi tên hoặc giả variant C:

```sh
node scripts/media/r2-upload.mjs uploads/docs3-muse-images-20261030/manifest.json uploads/m14.1/pilot1-upload.json --profile=pilot1 --apply
node scripts/media/r2-upload.mjs uploads/docs3-muse-images-20261030-batch2/manifest.json uploads/m14.1/pilot2-upload.json --profile=pilot2 --apply
```

| Profile            | prompt_version / key prefix | Nguồn prompt                  |
| ------------------ | --------------------------- | ----------------------------- |
| phone-c (mặc định) | muse-phone-c-v1             | image_prompt của sample C     |
| pilot1             | muse-illustration-pilot-v1  | prompt.txt nguyên văn của lô1 |
| pilot2             | muse-mixed-pilot-v1         | prompt.txt nguyên văn của lô2 |

Hai lô trước dùng `prompt_scope=batch_brief`, không khẳng định biết prompt con do Muse tự dựng.
Receipt/registrar chỉ nhận các version trên, key phải khớp version/hash và prompt tối đa 32.768 ký tự.
Mỗi lô vẫn tối đa 20 asset; kiểm source definition/hash như C. Copy helper/registrar mới lên VPS
trước khi đọc receipt có profile mới. Sau register mỗi lô, dùng `pilot1-bindings.json` hoặc
`pilot2-bindings.json` với `bind-existing.mjs` theo cùng cú pháp dry-run/apply ở trên.
[bulk40-anchors.json](./bulk40-anchors.json) lưu lựa chọn theo definition/POS, gồm nghĩa cụ thể
của grill/dairy/stir/marinate. Không tạo mapping từ điển mới hoặc nâng trạng thái concept.
Cả ảnh thay thế được lưu approved; view hiện trả mỗi concept một primary. Bốn ảnh C giữ primary
cho breakfast/fry/spicy/picnic; phiên bản cũ của bốn từ đó là alternate trong concept_media.
API danh sách alternate/gallery chưa được triển khai.
