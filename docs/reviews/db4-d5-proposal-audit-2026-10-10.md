# DB4-D5 — Audit chất lượng proposal exact

Ngày: 2026-10-10. Trạng thái: code và audit 20 proposal đã kiểm local; **quality
gate chưa đạt**, chưa commit/push/deploy/apply. Không gọi thêm Muse/API/DB.

## Kết quả thực tế

| Phạm vi                                          | Số lượng |
| ------------------------------------------------ | -------: |
| Target trong retrieval gốc                       |      100 |
| Exact proposals D3, audit đủ từng dòng           |       20 |
| Pass theo AI reviewer                            |       16 |
| Fail / severe                                    |    2 / 2 |
| Deferred vì thiếu chứng cứ scope                 |        2 |
| Target ngoài phạm vi audit đợt này               |       80 |
| Mapping ghi DB / accepted / served trong đợt này |        0 |

Tỷ lệ pass theo audit AI: **16/20 = 80%**, tính cả deferred trong mẫu số. Không
gọi đây là precision đã chứng minh bằng expert gold, accuracy của toàn 100 target
hoặc toàn 15k sense. Khoảng Wilson 95% của nhãn quan sát: khoảng 58,4–91,9%; đây
chỉ là mô tả mẫu nhỏ, có nhiều sense cùng lexeme và thiên lệch chọn proposal
consensus, không là bảo đảm độc lập thống kê cho production.

Reviewer: Codex trong phiên này, `reviewerKind=llm`,
`reviewerId=codex-session-reviewer`, session `db4-d5-context-audit-2026-10-10`.
Đọc context nguồn trước, sau đó đọc reason Muse để xác định cơ chế lỗi. Không
giả người duyệt, API R2 mới, phiên model cụ thể không biết hoặc expert gold.
AI audit có thể sai; fail/deferred là đánh giá theo rubric exact toàn scope của
DB4. Hai lượt R1/R2 là cùng Muse, đã cùng đồng ý các ca fail này.

## Bốn proposal bị chặn

| Source sense                      | Concept | Verdict       | Lý do                                                                                                                                                                                                                                                        |
| --------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `jmdict:1032390:2` — オーバー     | 45454   | fail / severe | “exceeding / going over / going beyond” không đòi hỏi “superior or better than some standard”. Concept chưa bao phủ vượt mức/giới hạn mà không tốt hơn; nhãn `exceed` không đủ thay definition.                                                              |
| `jmdict:1009330:2` — どんな       | 20501   | fail / severe | `as どんな...でも, どんな...も` ràng buộc nghĩa “bất kể loại nào”. Definition có cả “one or some” và elective existential; cần phân biệt universal/free-choice với một/vài không chỉ định. Muse bỏ hiệu lực qualifier và gọi exact theo nhãn `any/whatever`. |
| `jmdict:1017330:1` — アナウンサー | 105111  | deferred      | Gloss announcer/presenter/broadcaster/reporter chưa có definition/example để kiểm phạm vi reporter và người phát sóng radio/TV. Không coi bốn gloss là bốn nghĩa rời hoặc tự kết luận mọi reporter đều broadcast.                                            |
| `jmdict:1001830:2` — お兄さん     | 111243  | deferred      | `oft. vocative`, `fam`; young man/buddy/fella/laddie chưa đủ chứng cứ mọi lời gọi này giới hạn ở teenager/young adult như definition concept. Không nhập sense older brother.                                                                                |

Fail đề xuất `accept_nonexact` **chỉ là hướng sửa**, chưa xác định relation mới
hay tạo quyết định thay thế đã accepted. Deferred đề xuất `defer`. Không sửa
R1/R2 hoặc decision gốc để đổi metric, không thêm blacklist lemma vội vàng.

## Danh sách đủ 20 proposal

| Sense ID | Lemma                              | Concept | Audit         |
| -------- | ---------------------------------- | ------- | ------------- |
| 1229     | アパート — tòa nhà căn hộ          | 62206   | pass          |
| 138      | お嬢さん — young lady              | 106781  | pass          |
| 1961     | オーバー — overcoat                | 67021   | pass          |
| 2315     | カレンダー — calender machine      | 63641   | pass          |
| 160      | お茶 — tea ceremony                | 51866   | pass          |
| 1201     | アナウンサー                       | 105111  | deferred      |
| 1743     | エスカレーター                     | 65956   | pass          |
| 1230     | アパート — căn hộ riêng            | 62205   | pass          |
| 1933     | オートバイ                         | 69214   | pass          |
| 1962     | オーバー — vượt mức                | 45454   | fail / severe |
| 268      | 屹度 — sternly/severely            | 28553   | pass          |
| 751      | どんな — no matter what            | 20501   | fail / severe |
| 124      | お姉さん — older sister            | 104955  | pass          |
| 1965     | オーバー — overexposure, photo     | 51189   | pass          |
| 2128     | カーテン                           | 65033   | pass          |
| 1851     | エレベーター                       | 65870   | pass          |
| 113      | お兄さん — older brother           | 104951  | pass          |
| 104      | お菓子                             | 91793   | pass          |
| 114      | お兄さん — vocative young man      | 111243  | deferred      |
| 23       | 彼処 — genitals, kana restrictions | 79778   | pass          |

VI ở bảng là diễn giải báo cáo, không dùng làm ground truth. Các trường đầy đủ:
[20 MappingAudit D1](db4-d5-exact-audit-2026-10-10.jsonl) và
[report JSON + context JA/EN/concept, raw attributes](db4-d5-proposal-audit-2026-10-10.json).
Projection context trong report không thay toàn candidate để recompute inputHash;
consumer dùng generation gốc có ref trong manifest D3.

## Code và kiểm tra

- [Plan/CLI](../plans/db4-d5-proposal-audit.md),
  [mapping-audit.ts](../../scripts/db4/mapping-audit.ts),
  [audit.test.ts](../../scripts/db4/audit.test.ts).
- Tool replay D3 từ frozen generation/proof/raw responses, kiểm decision manifest
  và hash từng file, yêu cầu audit đủ mọi exact proposal, không duplicate/foreign.
  `parseMappingAudit` kiểm inputHash/R1/R2/decisionHash; pass mâu thuẫn suggestion,
  pass severe hoặc pass chỉ từ structural rule đều bị chặn.
- Fail/deferred không có trong `passed-proposals.jsonl`. Pass giữ
  `verified=false`, `calibratedScore=null`, thêm `auditHash`, `auditPassed=true`.
  Đây là subset để kiểm tiếp; **không cấp eligibility D6**. Severe chặn đợt.
- `node --import tsx --test scripts/db4/*.test.ts`: **65/65 pass**, không skip;
  trong đó 10 test D5 kiểm binding, denominator, verdict và immutable publication.
- `npx tsc -p tsconfig.db4.json`: pass.
- `npx eslint scripts/db4/mapping-audit.ts scripts/db4/audit.test.ts --max-warnings 0`: pass.
- CLI thực tế trên 20 audit: pass integrity và xuất đúng 16/2/2; rerun cho cùng
  manifest/hash, không ghi đè output cũ.
- Prettier files D5, JSON/JSONL/link/whitespace và `git diff --check`: pass;
  đã kiểm working tree. Không chạy backend build/DB integration vì chỉ offline tool.

## Artifact / handoff D6

Root local: `uploads/db4-d2-pilot` (ignored; giữ cùng generation/source-proof và
raw D4 artifacts khi chuyển môi trường).

- D3: `muse-d3-v1/208f8206aa7dc1f3810f29df36bebb91f2f4b0f48b5a5a81b7109f04d9c3c90e/manifest.json`.
- D5: `muse-d5-v1/7b12c86d214ae5258c7c0bb8c1eaea9cac9a877c0b8512970d81891f85ffbeac/manifest.json`.
- D5 manifest SHA-256: `9ce61f2191c2dac3722b735f97802c7eb3fde51e7071bcc6cfc9c0d053fcfb40`.
- Run gồm `audits.jsonl`, `passed-proposals.jsonl`, `report.json`, `manifest.json`;
  hash audit bytes + D3 manifest định danh run; manifest publish cuối.
- CLI exit 0 nghĩa integrity thành công, **không có nghĩa quality pass**. Consumer
  phải đọc flags/gates. `apply=false`, `promotionReady=false`,
  `fullPilotGatePassed=false`, `fullTargetGateEvaluated=false` trong mọi run scope này.

```bash
npx tsx scripts/db4/mapping-audit.ts \
  uploads/db4-d2-pilot \
  muse-d3-v1/208f8206aa7dc1f3810f29df36bebb91f2f4b0f48b5a5a81b7109f04d9c3c90e/manifest.json \
  docs/reviews/db4-d5-exact-audit-2026-10-10.jsonl
```

## Việc tiếp theo và gate còn thiếu

1. D4 prompt/context version mới: ưu tiên definition hơn nhãn; kiểm qualifier
   theo construction; yêu cầu chỉ ra nguồn chứng minh mỗi điều kiện hai chiều.
   Khi không chứng minh được exact thì nonexact/uncertain, không tự điền context
   nghề nghiệp/tuổi. Cần kiểm bằng phản ví dụ để tránh hai lượt lặp cùng suy đoán.
2. Chạy lại cohort có cap, giữ output cũ và tách metric trước/sau sửa. Không
   hardcode loại một từ đa nghĩa; các sense đúng của オーバー/お兄さん vẫn được giữ.
3. Audit đủ 100 target Pilot A, gồm 31 no-candidate/1 incomplete và các candidate
   khác; báo strata hiện mới N5/N4. Đợt này chưa tính target-level accuracy/recall.
4. Pilot B chưa đủ ≥100 positive + ≥50 hard-negative, chưa có holdout/recall@5,
   calibration và budget/unknown-usage gate. Hai severe làm gate fail hiện tại.
5. D6 journal/preflight/rollback và D7 serving chưa triển khai; không apply trước gate.

Git / triển khai: code/test/docs D5 đã lưu local, **chưa commit/push**. Không deploy
VPS, không gọi provider, không đổi link/concept/gloss hoặc confidence DB. Giữ các
thay đổi chưa commit của các hạng mục khác.
