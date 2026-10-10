# DB4-D4 — Prompt semantic match v2.1 và version-safe repair

Ngày: 2026-10-10. Trạng thái: prompt v2.1 và đường prepare → repair → validate
đã qua kiểm tra offline. **Chưa gửi prompt v2.1 cho Muse; chưa có kết luận chất
lượng ngữ nghĩa, chưa apply DB hoặc deploy.**

## Vì sao cần v2.1

Lượt sample v2 có 30 sense / 15 lemma, 60 phản hồi; D1 chấp nhận 59/60 và pure
D3 tạo 1 proposal exact. Đây là mẫu phát triển prompt, không đại diện toàn cohort
và không chứng minh precision. Các lỗi cụ thể dẫn tới thay đổi giới hạn:

| Bằng chứng sample                                                                                                        | Nguy cơ                                                     | Điều chỉnh trong v2.1                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| お宅: `your husband` / `your organization` bị diễn giải thành nghĩa hẹp theo người nghe                                  | Possessive/pragmatic viewpoint bị nhầm thành loại đối tượng | Chỉ coi quan hệ sở hữu là ràng buộc denotation khi source nói rõ; không tự bỏ ràng buộc thật                                       |
| アルコール: hand sanitizer bị R2 cho exact với rubbing alcohol; model còn tự mở rộng thành compound không có trong input | Suy diễn thành phần hoặc tự viết thêm source context        | Không mở rộng abbreviation, ellipsis, tên sản phẩm/chất; thiếu composition thì không được giả định để tạo inclusion/counterexample |
| すっと: model mở rộng gloss thành các cách dùng nhẹ/êm không được xác lập rõ trong bundle                                | Tình huống giả định bị dùng như bằng chứng phạm vi          | Boundary witness phải được entail hoặc loại trừ bởi source/concept wording, không chỉ có vẻ hợp ngoài đời                          |
| Police officer: output thêm `missingBranches2`, D1 từ chối                                                               | Extra field làm mất output hợp lệ                           | Nhắc kiểm exact output keys; raw reply sai contract vẫn invalid, repair tối đa một lần                                             |

Không thêm đáp án/candidate ID/audit vào prompt. Những ca này là development
evidence; v2.1 chưa được kiểm bằng Muse nên không được tính là xử lý xong các ca.

## Thay đổi

- Ba file prompt mới kế thừa v2; v1/v2 giữ nguyên. System v2.1 nêu rõ giới hạn
  possessive/reference, không suy composition và witness phải bám dữ liệu.
- R1/R2 nhận hướng dẫn ngắn tương ứng với vai trò phase.
- `muse-review-prepare.ts` giữ default v1, nhận `v1`, `v2`, `v2.1` và tạo
  prefix/version/hash riêng.
- Module version chung parse base và `repair1`; repair đọc revision từ prompt
  artifact, kiểm request version, chặn repair đệ quy và hơn một repair/bundle;
  validator kiểm version từng request và ghi kết quả trong
  `muse-d4-<revision>/validated/`.
- Hành vi v1 giữ nguyên đường dẫn/version legacy. Test khóa SHA-256 raw ba file
  v2 để tránh sửa prompt đã dùng.

## Prompt artifact hashes

SHA-256 theo bytes file:

| File                                                            | SHA-256                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| [System v2.1](../prompts/db4-d4-semantic-match-v2.1.system.txt) | `f446d6347b77fcd739141af24ea3060cf170baa11d3100dee8eb6948ad80efc9` |
| [R1 v2.1](../prompts/db4-d4-semantic-match-v2.1.r1.txt)         | `06eb47a649685c6f030685f77fdb4b78ef0c4c866d587b1b11d31cd8e0a8ce9e` |
| [R2 v2.1](../prompts/db4-d4-semantic-match-v2.1.r2.txt)         | `2284e44c728ed3a1de18f82c7feedc2313f927baf50f09a23503f55505154c86` |

## Kiểm tra

- `npx tsc -p tsconfig.db4.json --noEmit`: pass.
- `npx eslint scripts/db4/muse-prompt-version.ts scripts/db4/muse-prompt-version.test.ts scripts/db4/muse-review-prepare.ts scripts/db4/muse-review-prepare.test.ts scripts/db4/muse-review-prepare-repairs.ts scripts/db4/muse-review-validate.ts --max-warnings 0`: pass.
- `npx prettier --check` trên sáu file TypeScript ở trên: pass.
- `node --import tsx --test scripts/db4/*.test.ts`: **80/80 pass**, không skip.
  Regression chạy generation fixture qua v1 default, v2, v2.1; sau đó giả lập
  hai phase lỗi trong cùng bundle bị chặn vì vượt cap; một invalid output tạo
  đúng một repair v2.1, validate phản hồi và xác nhận
  output ghi vào thư mục `muse-d4-v2.1`.
- Fixture synthetic chỉ kiểm artifact binding/schema, không đo chất lượng match.

## Gate còn thiếu và trạng thái

- Prompt chỉ freeze về bytes/hash, chưa gọi Muse hoặc kiểm sample mới.
- Chưa có durable batch runner/recovery smoke, vì vậy **không dispatch Muse**.
- Chưa chạy D5 quality gate/Pilot A/B; chưa có D6 journal/apply/rollback hoặc D7
  serving gate. Không sửa DB hay deploy ứng dụng.
- Git / triển khai: commit `379ba5f` đã push lên `origin/main`; không deploy
  hoặc apply DB. Thay đổi của FE handoff và D5 repeat ngoài phạm vi vẫn để nguyên.
