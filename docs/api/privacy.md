# M12.1 — Privacy API

Ngày03/11/2026. [Handoff FE](../handoff/m12.1-privacy-fe-2026-11-03.md).
Migration `047_privacy_controls.sql` phải được áp trước phục vụ các endpoint/state
và kiểmAI dùngDB. Không có secret hoặc nội dung chat trong ledger/ticket.

## Public manifest

`GET /v1/legal/manifest`200: `notice_version`, `notice_url`, `ai_consent_required`,
`age_policy:{minimum_age:null,representative_verification:"not_implemented"}`,
`purposes:[{purpose_id,description_vi}]`, `rights_contact_email`.
Version đầu `2026-11-03-v1`. Không đổi mụcđích/nội dung có nghĩa mà giữ nguyênversion.
FE phải trình bày đúng thông báo và bên nhận được kiểm, không coi registry là căn cứ pháp lý đã duyệt.

## State/events — JWT

`GET /v1/me/privacy`200: `{notice_version,ai_consent_required,choices:[{purpose_id,state}]}`.
Purpose: `ai_assistance|online_translation|analytics`.
State: `needs_action|granted|withdrawn`; không có rowkhông tựgranted.

`POST /v1/me/privacy/events`201:
`{purpose_id,action:"grant"|"withdraw",notice_version,request_id:UUID}`.
Trả `{id:string,request_id,purpose_id,action,notice_version,created_at:ISO}`.
Đây làreceipt củaevent, không phải currentstate. GET lại state sau mỗi retry/save.
Cùnguser/requestid/body replay receipt; khácbody409PRIVACY_REQUEST_CONFLICT.
Grant mới khác currentversion409PRIVACY_NOTICE_OUTDATED; replay committedgrant cũ vẫn
thành công. Withdraw được dùngversioncũ. Timestamp/user_id từserver.

## Data-rights requests — JWT

`POST /v1/me/privacy/requests`202: `{kind,request_id:UUID}`.
Kind `access|rectification|erasure|restriction|objection`.
Trả requestresource: `id,request_id,kind,status,received_at,acknowledged_at,target_at,
updated_at,rejection_reason,resolution_reference`.
Intake autoack sau transaction thành công; request retry giữid, kháckind409.
Target cơ bản10/10/20/15/15ngày lịch; chưa xửlý ngoại lệ/gia hạn tựđộng.
`resolution_reference` nullable/future schema reserved; API không nhận hoặc ghi completion evidence.

`GET /v1/me/privacy/requests?cursor=UUID`200: `{data,next_cursor:string|null}`,
50/trang, orderUUID giảm (cursor opaque); stableunique không cầnDateprecision.
`GET /v1/me/privacy/requests/:id`200 hoặc404khi không thuộcuser.
Statushiện tại `received|in_progress|rejected`; schemabảo lưucompleted cho pha khác,
nhưng không có API chuyểncompleted trong release này. Ticketkhông phải tựđộngxuất/xóa.

## Admin — role admin cònactive

`GET /v1/admin/privacy/requests?cursor=UUID`200: list50, mỗi record thêmuser_id nội bộ
choadmin xác định chủ thể; không lộ ở danh sách người dùng khác. Không trảemail/PII dư.
`PATCH /v1/admin/privacy/requests/:id`200:
`{status:"in_progress"|"rejected",rejection_reason?:"identity_unverified"|"outside_scope"|"duplicate"}`.
Rejectedbắtbuộc lýdo; in_progresskhông có lýdo. Không mở lại terminalrequest, cậpnhật
có lockrow vàadminaudit cùngtransaction. Không nhậncompleted hoặc free-text/URL evidence.
Admin lấyuser_id để tiếp nhận theo runbook; không gọi SQLxóa tùyý từUI.

## Errors và enforcement

Envelope `{code,message,details?}`. Validation400, unauthorized401,
adminrequired403, scopedrequestnotfound404, idempotency/version/state409,
privacyDBfail503PRIVACY_UNAVAILABLE (không lộ SQL/stack).
AI deny403PRIVACY_CONSENT_REQUIRED; trướcSSEheaders làHTTP, sauheaders theoerrorframe.
Chatcheck trướcquota và trước mỗi providerattempt; quizcheck tại mỗi transportattempt
để localquiz không bịépgrant. Thu hồi đã ghi chặn lần gửi mới, không thu hồi được
payloadđã gửi. Có cửa sổ check→dispatch và request đang chạy; chưa có distributed cancellation.

ENV `PRIVACY_AI_CONSENT_REQUIRED=false` mặc định rolloutcompatible. Withdrawalwaysdeny;
truecòn deny missing/oldgrant. PublishBE→tíchhợpFE→QA→bậttrue, ghi rõ gate này.
Không được coi cờfalse là trạng thái tuân thủ hoàn tất. Không có authDTOlegalcontext,
không áp minimumage, không có guardianverification hay automaticdataexport/deletion.

## M12.1 — Terms acceptance (04/11/2026, additive)

Migration `048_terms_acceptance.sql` đã áp trước push; runtime mới cần CI/deploy xác nhận. Không thay auth DTO,
không thêm purpose terms vào privacy events và không ngầm grant AI/dịch/analytics.
Manifest thêm `terms_version=2026-11-04-v1`, `terms_url=https://langoo.org/terms`;
privacy `notice_version=2026-11-03-v1` độc lập.

| Endpoint JWT | Contract |
|---|---|
| GET `/v1/me/legal/terms` | 200 `{terms_version,status:accepted|needs_action,latest_acceptance:receipt|null}` |
| POST `/v1/me/legal/terms` | body `{terms_version,request_id:UUID}`, 201 receipt `{id:string,request_id,terms_version,accepted_at:ISO8601}` |

User lấy từ JWT, không nhận user_id/profile_id/accept_all. DB timestamp, version mới
phải bằng manifest. Unique user/request; same body replay trước version validation,
khác body409 `TERMS_REQUEST_CONFLICT`, stale new body409 `TERMS_VERSION_OUTDATED`.
DB fail503 `PRIVACY_UNAVAILABLE`; bad input/extra400, auth401. Receipt replay lịch sử
không thay state hiện hành. GET chọn record mới nhất theo identity ID; old version
trả needs_action và vẫn có latest_acceptance lịch sử. Không có API withdraw terms.

FE một click orchestrate 1 terms + 3 purpose grants với 4 UUID khác nhau; không có
transaction HTTP chung, partial failure phải xử lý riêng. Không gửi grant tự động
khi mount/auth callback. Chỉ hoàn tất sau refetch đúng 2 state. Gate terms toàn app
chỉ ở FE trong pha này, chưa có server guard áp lên mọi route.
[Handoff đầy đủ](../handoff/m12.1-accept-all-fe-2026-11-04.md).
