# M11.1 — Đa dạng hóa quiz trắc nghiệm bằng dạng Kanji JLPT

> Ngày: 06/10/2026 · Plan mở rộng M11 đã được duyệt và triển khai backend; build/lint + 374 unit / 199 E2E local pass. [Báo cáo](../reviews/m11-1-kanji-quiz-2026-10-06.md). Pilot model thật/UI/rollout còn chờ.
> Chủ dự án đã rút yêu cầu điều tra collection rỗng. Task hiện tại: thêm dạng câu hỏi trắc nghiệm như Mondai 1–2 phần Kanji/từ vựng.
> Người dùng chốt nguồn ngữ cảnh: dùng câu ví dụ trong từ điển và tự sinh thêm câu xoay quanh từ đang học. Đợt đầu áp dụng ngữ cảnh cho hai dạng Kanji; điền từ trong câu là style mở rộng riêng.
> Người dùng bổ sung: câu hỏi nghĩa, nối từ và các dạng dựng được từ dữ liệu không gọi AI, nhằm tiết kiệm token. Chỉ phần thiếu ngữ cảnh/kiểm ngữ cảnh chưa có evidence mới cần model.

## 1. Mục tiêu và dạng câu hỏi

| Style               | Nội dung                                       | Phương án                 | Prompt ví dụ tự soạn                                   |
| ------------------- | ---------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| `meaning`           | Nghĩa từ như M11 hiện tại                      | VI/nguồn nghĩa hiện có    | Nghĩa của 「学校」 là gì?                              |
| `kanji_reading`     | Nhìn từ viết bằng Kanji, chọn cách đọc         | 4 cách đọc kana khác nhau | 「学校」の読み方はどれですか。                         |
| `kanji_orthography` | Nhìn kana và gợi ý nghĩa, chọn cách viết Kanji | 4 dạng viết khác nhau     | 「がっこう」（trường học）を漢字で書くと、どれですか。 |

Theo [cấu trúc JLPT chính thức](https://www.jlpt.jp/e/guideline/testsections.html), Kanji reading có N1–N5; orthography có N2–N5. Không gọi hai style này là Mondai 1–2 cố định cho mọi cấp/phần thi. Feature là luyện kỹ năng tương ứng; đợt đầu chưa mô phỏng nguyên đề JLPT hoặc cấp độ chính thức.

Hai dạng Kanji có thể đặt từ cần hỏi trong câu và đánh dấu target. Ví dụ tự soạn: `毎日、学校へ行きます。` → hỏi cách đọc của `学校`; hoặc `毎日、がっこうへ行きます。` → hỏi Kanji của `がっこう`. Câu từ từ điển và câu tự sinh đều phải dùng đúng anchor sense. Không lấy câu bất kỳ có cùng mặt chữ rồi coi là đúng nghĩa.

### 1.1 Phân tuyến dữ liệu và AI để tiết kiệm token

| Dạng câu hỏi                                                  | Cách sinh                                                        | Có gọi model không?                           |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Nghĩa của từ                                                  | Từ–nghĩa đúng anchor sense, nhiễu từ pool, template và shuffle   | Không                                         |
| Nối từ–nghĩa                                                  | Chọn các cặp phân biệt được từ dữ liệu, shuffle hai vế           | Không                                         |
| Fill-blank hiện tại (gợi ý nghĩa → nhập từ)                   | Template, đáp án/reading/romaji nguồn                            | Không                                         |
| Đọc Kanji / chọn Kanji, không câu ngữ cảnh                    | Forms/restrictions đúng sense + template + nhiễu hợp lệ          | Không                                         |
| Kanji trong câu nguồn hoặc câu đã sinh và đã kiểm phù hợp     | Tái sử dụng câu và evidence, kiểm cấu trúc/mask/đáp án bằng code | Không nếu evidence còn hợp lệ cho câu hỏi này |
| Câu từ điển chưa có evidence kiểm ngữ cảnh                    | Dữ liệu nguồn + kiểm ngữ nghĩa một lần, lưu evidence             | Chỉ kiểm câu, không sinh lại câu nguồn        |
| Thiếu câu phù hợp hoặc chưa đủ đa dạng trong pool câu đã kiểm | Sinh câu quanh đúng sense, rồi kiểm độc lập                      | Có, chỉ cho những slot thiếu                  |

Backend dựng lịch câu hỏi và đáp án trước, phân tuyến từng slot. Quiz mixed không gửi toàn bộ bài đến LLM: meaning/matching/fill-blank hiện tại chạy local dù adapter AI đã cấu hình. AI không chấm option_index, không sinh lại nghĩa, không viết explanation cho câu template; explanation dữ liệu dùng template. Không coi fill-blank hiện tại là dạng chọn từ điền vào câu chưa triển khai.

Tên `StubQuizProvider` hiện tại dễ khiến hiểu là dữ liệu giả, nhưng code đang dựng quiz từ items thật bằng `buildQuizQuestions()` và không gọi mạng. Trong triển khai cần phân biệt generator dữ liệu với adapter ngữ cảnh; không đưa mọi request qua model chỉ vì bật AI_PROVIDER.

## 2. Contract tương thích API hiện tại

Giữ `quiz_type=multiple_choice` cho cả ba style. Chấm bằng `option_index` như hiện tại. `question_type` DB vẫn multiple_choice/fill_blank/matching; không thêm enum Kanji vào cột này.

Request mới tùy chọn:

```json
{
  "collection_id": "<uuid>",
  "quiz_type": "multiple_choice",
  "question_styles": ["kanji_reading", "kanji_orthography", "meaning"],
  "context_mode": "source_or_generated",
  "difficulty": "medium",
  "question_count": 10
}
```

Quy tắc:

- Bỏ `question_styles` → `['meaning']`, giữ behavior client cũ.
- Nhận mảng 1–3 style hợp lệ, không trùng; từ chối null, rỗng, kiểu sai hoặc extra enum.
- Style chỉ áp dụng request multiple_choice hoặc mixed. Với mixed, áp dụng vào các slot MC, giữ fill_blank/matching hiện có.
- Style Kanji chỉ dùng target Nhật có forms/reading đủ; resolve language bằng code, không hardcode ID=2.
- Normalize style set thành thứ tự canonical; dedup/cooldown phải so style config và generator version, không trả quiz nghĩa cũ cho request Kanji.
- Legacy request không tự bị chuyển sang style mới khi FE chưa bật lựa chọn.
- `context_mode`: `none` (mặc định client cũ), `source` (chỉ câu nguồn đủ điều kiện), `source_or_generated` (ưu tiên câu nguồn, bổ sung câu tự sinh). Chỉ nhận mode có context khi request có ít nhất một Kanji style; `meaning` giữ hành vi cũ. Mode là một phần của cooldown key.

Response từng câu và session prompt thêm `question_style`; legacy MC suy ra meaning khi metadata không có. `kind='multiple_choice'`, `options=[{index,text}]`, request answer và XP vẫn giữ contract hiện tại.

## 3. Persist style bằng metadata hiện có

Đề xuất không thêm migration ở đợt đầu: dùng `app.quiz.generator` JSONB đã có để lưu:

- provider/version;
- request style config đã canonicalize;
- per-question metadata theo ordinal, gồm style đã sinh thực tế;
- source/eligibility policy version khi cần.
- Với câu ngữ cảnh: origin, example/source IDs hoặc model/prompt version, source text hash, target sense/form/reading, validation result. Nội dung gốc và đáp án chỉ ở metadata nội bộ; response trước khi trả lời chỉ có câu đã render/mask và attribution cần thiết.

Provider trả thêm questionStyle; service validate mapping ordinal rồi lưu metadata cùng transaction tạo questions/ready. GET detail và start/session builder đọc cùng metadata để không mất style khi start lại hoặc source item bị xóa.

Snapshot `study_session_item.prompt` có question_style và text/options đầy đủ. Không chứa đáp án hoặc metadata riêng của cách chọn đáp án. Correct answer vẫn `{index,text}`.

Context public thêm `{ sentence, target: { start, end, text }, origin, attribution }`; offsets là chỉ số Unicode code point, end exclusive, tính trên sentence đã render. Reading giữ Kanji và không có furigana/romaji; orthography thay target bằng kana. Không trả sentence gốc chứa Kanji đáp án, translation làm lộ đáp án hoặc toàn bộ metadata generator. Khi `context_mode=none`, context là null. FE cần chuyển offsets theo code point, không cắt trực tiếp bằng UTF-16 index.

Metadata validator xử lý quiz cũ thiếu style và từ chối metadata sai của generator mới; không silently đổi một câu Kanji thành meaning. Nếu sau này cần câu/target-span hoặc query analytics theo style, đề xuất metadata schema/migration riêng.

## 4. Nguồn và tránh câu nhiều đáp án đúng

Repository giữ scope owner/profile/collection/SRS/paused như M11 hiện tại. Target item lấy từ scope request; đợt đầu distractor pool cũng lấy từ scope này, không tự mở toàn từ điển.

Nguồn Kanji cần đọc thêm:

- `serve.sense_card.lexeme_id`, source language;
- `core.lexeme_form` (kanji/kana, common/order/tags);
- `core.lexeme_form_applies_to` để biết kana tương ứng Kanji nào;
- `core.sense_form` để biết form thuộc đúng anchor sense.

Không chỉ đảo lemma/reading scalar vì một entry có thể nhiều cách đọc và cách viết. Không lấy on/kun của ký tự riêng để làm đáp án cách đọc của cả từ.

### Reading

1. Chọn Kanji form có trong target sense và reading pair hợp lệ.
2. Có nhiều reading hợp lệ mà prompt không phân biệt được → bỏ target khỏi reading pool ở đợt đầu.
3. Giữ toàn tập reading hợp lệ để loại distractor cũng đúng, kể cả reading không nằm trong collection.
4. Distractor là kana hợp lệ của item khác trong pool, khác đáp án sau chuẩn hóa; không dùng nghĩa VI làm nhiễu đọc.
5. Không đưa reading/romaji vào prompt, không vô tình lộ đáp án.

### Orthography

1. Chọn kana form liên kết đúng Kanji form/sense; thêm nghĩa đúng anchor sense để phân biệt từ đồng âm.
2. Các Kanji alias/variant hợp lệ của target không được làm distractor.
3. Hai target có cùng reading và nghĩa quá giống mà không thể phân biệt → bỏ target/option đó.
4. Distractor Kanji từ pool khác, ưu tiên độ dài/đặc điểm chữ gần nếu dữ liệu đủ; luôn kiểm không hợp lệ với target.
5. Không bịa một cách viết để gọi là đáp án đúng. Đợt đầu không sinh synthetic distractor bằng LLM.

Chuẩn hóa chỉ phục vụ so sánh/dedupe, giữ original text; kana dài, sokuon và dakuten là khác biệt có nghĩa, không xóa khi normalize. Form uncommon/search-only/irregular cần policy rõ; ban đầu ưu tiên common hoặc form nguồn chuẩn đủ evidence.

`prepareItems()` hiện dedupe theo meaningVi chỉ phù hợp style nghĩa. Pool Kanji phải build riêng theo form-reading identity, không loại các từ khác nhau chỉ vì cùng nghĩa VI. Các style không phụ thuộc VI machine trừ clue orthography; clue VI có provenance và không được dùng để quyết định reading pair.

## 5. Selection, thiếu nguồn và difficulty

- Kanji styles luôn 4 phương án để theo dạng luyện được chọn; style meaning giữ easy=3, medium/hard=4 như hiện tại.
- Difficulty Kanji ảnh hưởng mức gần của distractor nếu đủ dữ liệu; không gán easy=N5 hoặc hard=N1.
- Slot MC phân bố các style được yêu cầu theo cycle deterministic + RNG injectable. Các slot ít hơn số style không cam kết xuất hiện đủ mọi style; response/summary ghi số thực tế.
- Preflight mọi style yêu cầu và nguồn trước reserve quota. Nếu một style không có target + 3 distractor hợp lệ, trả `409 QUIZ_NOT_ENOUGH_ITEMS` với available/required/style; không silently thay bằng nghĩa hoặc bịa thêm đáp án. Mode source kiểm câu nguồn đủ điều kiện ở bước này; mode source_or_generated kiểm dữ liệu target/distractor và cấu hình provider, còn kiểm ngữ nghĩa câu sinh thực hiện sau gọi model.
- Bộ câu hỏi được validate rồi snapshot. Quota/cooldown/error recovery và item deletion behavior M11 giữ gate hiện hữu.
- Mode none/source có thể sinh câu hỏi bằng generator dữ liệu. Mode source_or_generated cần adapter sinh và kiểm câu thật khi thiếu câu nguồn; factory quiz hiện chỉ trả stub nên phải bổ sung, không coi cấu hình chat hiện tại là quiz đã gọi AI.
- Router chỉ gọi adapter ngữ cảnh cho slot cần generation/semantic validation. Quiz không có slot như vậy phải chạy được khi không có key/model và có zero network calls; việc provider AI tồn tại không thay tuyến của câu dữ liệu.

## 6. File dự kiến

| File                                                                        | Thay đổi                                                                           |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/ai/quiz/dto/quiz.dto.ts`                                               | Validate question_styles/null/duplicates/type compatibility                        |
| `src/ai/providers/ai-quiz.provider.ts`                                      | Source form metadata, questionStyle, generator style config                        |
| `src/ai/providers/stub-quiz.provider.ts`                                    | Truyền style config                                                                |
| `src/ai/quiz/quiz-generator.ts`                                             | Style pools/scheduler/reading/orthography/unique answers/preflight                 |
| `src/ai/quiz/repositories/quiz-source.repository.ts`                        | Forms/reading restrictions theo sense, giữ source scope                            |
| Repository câu ví dụ trong `src/ai/quiz/repositories/`                      | Câu JA gắn sense, mapping verified, source attribution, truy vấn batch             |
| Context types/builder/validator trong `src/ai/quiz/`                        | Target span, masking, source selection, ngữ nghĩa và một đáp án đúng               |
| Context provider thật và `ai-quiz-provider.factory.ts`                      | Sinh câu/kiểm câu qua adapter OpenAI-compatible; không silent fallback stub        |
| Context router/reuse repository trong `src/ai/quiz/`                        | Phân tuyến từng slot, đọc context/evidence từ quiz snapshot đã lưu, giảm gọi model |
| `src/config/env.schema.ts`, `.env.example`                                  | Model/timeout cho quiz, validation cấu hình; không ghi key thật                    |
| `src/ai/quiz/quiz.service.ts`                                               | Persist generator metadata, version/cooldown, public style/session snapshot        |
| `src/ai/quiz/types/quiz.types.ts`                                           | Additive response style/config                                                     |
| `src/ai/quiz/quiz.controller.ts`                                            | Swagger mô tả styles/errors                                                        |
| Quiz generator/service/repository specs, `test/quiz-regression.e2e-spec.ts` | Regression theo rủi ro bên dưới                                                    |
| `docs/api/quizzes.md`, docs FE liên quan, `PROGRESS.md`                     | Contract/handoff sau triển khai                                                    |

Giữ PostgreSQL schema, Prisma model và grading `option_index` hiện hữu. Source queries chỉ đọc core/serve; mutations vẫn app. Nếu kiểm code thấy JSON metadata không đáp ứng snapshot chắc chắn, trình migration cụ thể trước thay schema, không tự đổi DB đích.

## 7. Test và nghiệm thu

1. Reading/orthography 4 options unique, đúng 1 đáp án, grading đúng mọi index.
2. Không lộ reading trong prompt reading; clue/target không vô tình lộ Kanji trong orthography.
3. Multiple readings, alternate spellings, restriction theo sense, homophones và equivalent VI clues không tạo multi-correct.
4. Meaning dedup không làm mất Kanji pool; missing reading, kana-only, non-JA, uncommon/search-only xử lý đúng.
5. DTO absent/null/empty/duplicate/invalid styles và incompatible quiz_type.
6. Multiple-choice mixed styles và quiz_type=mixed giữ fill_blank/matching, đủ count.
7. Source insufficient trả 409 trước quota/provider/quiz-row claim; không đổi style âm thầm.
8. Cooldown reuse đúng style set, đổi style không reuse, old version không reuse với new request.
9. GET/start giữ style và không lộ answer; source item xóa vẫn làm quiz snapshot cũ được.
10. Legacy quiz metadata thiếu style vẫn đọc/start/chấm như trước; metadata malformed bị xử lý rõ.
11. Regression M11 scope/profile/SRS/archived/quota/recovery và answer receipt/XP không thay.
12. Build/lint/unit liên quan và E2E quiz trên DB test local riêng; không reset DB full/VPS hoặc gọi LLM thật.
13. Source sentence sai sense, chưa verified mapping, target absent/duplicate hoặc license thiếu evidence không được chọn; không dùng Tatoeba chỉ vì có mặt chữ.
14. Sinh câu malformed, sai span, sai nghĩa/ngữ pháp hoặc có đáp án thứ hai bị loại; retry có giới hạn; thất bại không lưu quiz ready một phần.
15. Orthography không lộ Kanji trong context/explanation/attribution trước khi trả lời; reading không lộ reading/romaji. Unicode offsets đúng với ký tự ngoài BMP.
16. Nguồn dictionary và generated giữ provenance sau GET/start và sau khi item nguồn bị xóa; cooldown xét context mode/policy version.
17. Provider/context tests dùng mock HTTP và fixture đã kiểm, không cần key thật. Gate cuối theo PROMPT-BACKEND.md: build, lint, unit và E2E local; gọi model thật để chấm pilot là bước riêng khi có cấu hình.
18. Meaning/matching/fill-blank hiện tại và Kanji mode none không gọi generator/validator/HTTP, kể cả khi AI_PROVIDER được bật. Mixed chỉ gửi slot ngữ cảnh thiếu evidence; input model không chứa các câu dữ liệu còn lại.
19. Reuse đúng fingerprint không gọi model; thay sense/form/source text/policy hoặc đổi bộ options làm evidence không còn phù hợp phải kiểm lại. Shuffle thứ tự options không làm cache miss nếu text/đáp án không đổi.
20. Token metrics chỉ cộng usage của request model thực sự; câu local và cache hit có tokens_in/out=0. Không đổi quota sản phẩm hiện tại chỉ vì một quiz không tốn token.

## 8. FE và bàn giao

FE có thể thêm lựa chọn Nghĩa / Đọc Kanji / Chọn Kanji / Trộn dạng. Request gửi question_styles tương ứng; renderer vẫn dùng MC options/index, có question_style để đặt nhãn. Quiz tiếng Anh giữ style meaning.

Với Kanji, UI mới mặc định đề xuất câu ngữ cảnh `source_or_generated`; hiển thị target rõ, ghi nguồn từ điển hoặc nhãn câu AI tạo. Lựa chọn từ riêng lẻ dùng mode none. Backend không đổi mặc định cho client cũ.

Không coi thêm field BE là đã làm UI nếu repo FE chưa được giao. Bàn giao request/response/examples/error details để FE tích hợp; default client cũ tiếp tục hoạt động.

## 9. Câu từ từ điển và câu tự sinh — phạm vi đã được yêu cầu

### 9.1 Nguồn từ điển

- API từ điển hiện đọc `core.example WHERE sense_id = ...`. Quiz đọc theo anchor sense và language ja; bổ sung đường `core.example_sense` chỉ khi `verified=true AND relation='illustrates'`. Dedupe example ID; query batch, không N+1.
- Direct sense link là evidence nguồn, không tự bảo đảm ngữ nghĩa. Cần kiểm target form có trong câu, đúng nghĩa của sense đang học, câu tự nhiên và ngữ cảnh không cho nhiều đáp án. Kiểm semantic của câu nguồn cũng dùng context validator; nếu chưa có validator/fixture đã kiểm thì không tự hạ gate để chạy offline.
- Đọc source/batch và attribution để giữ nguồn khi snapshot. Chỉ tái sử dụng nguồn có điều kiện sử dụng đã được xác minh; nguồn thiếu evidence bị bỏ qua và ghi lý do, không gán license phỏng đoán.
- `example_annotation` matched chỉ giúp liên kết câu canonical, không thay thế sense alignment. Cặp Tatoeba JA–VI/artifact DB3-B không có sense alignment đủ thì chưa phải input quiz.

### 9.2 Câu tự sinh quanh đúng từ/nghĩa

- Input model gồm target sense ID, Kanji–kana pair đã resolve, POS, EN gloss đầy đủ của đúng sense, VI gloss và trạng thái review nếu có, difficulty mong muốn. Không chỉ đưa lemma hoặc gom nhiều nghĩa của entry làm một input.
- Model sinh câu JA ngắn, tự nhiên, đủ ngữ cảnh, chứa target đúng một lần; ưu tiên target ở dạng từ điển trong đợt đầu để không suy diễn inflection-reading. Sinh thêm câu giúp đa dạng ngữ cảnh; không bịa reading, spelling hay chuyển đáp án sang sense khác.
- Output JSON strict: sentence, target span/text, intended sense explanation cho validator. Explanation này nội bộ, không hiển thị trước khi làm bài. Không nhận options/correct answer do model tự quyết: đáp án vẫn từ form data, distractor qua bộ lọc.
- Kiểm độc lập bằng prompt validator khác với prompt sinh; chạy trên cả sentence và bộ bốn options. Validator đánh giá đúng nghĩa, ngữ pháp, target reading/form, không lộ đáp án và mỗi option có đúng trong ngữ cảnh hay không. Chỉ nhận khi đúng duy nhất đáp án từ từ điển; thiếu chắc chắn thì loại. Model tự báo đạt không đủ để chấp nhận.
- Bộ kiểm cấu trúc deterministic chạy trước/sau semantic validation: JSON schema, sentence length, target occurrence/span, unique options, alias exclusions, normalization, answer leak. AI verification vẫn có thể sai; không ghi là tương đương người bản ngữ duyệt hoặc đảm bảo 100%.
- Dùng adapter OpenAI-compatible hiện có làm nền transport; thêm `AI_QUIZ_MODEL`, `AI_QUIZ_VALIDATOR_MODEL` và `AI_QUIZ_TIMEOUT_MS` riêng, tái sử dụng base URL/key đã cấu hình. Validator có thể cùng model nhưng request/prompt độc lập; model riêng khi được cấu hình. Không mặc định fallback sang AI_CHAT_MODEL.
- Kiểm nhu cầu model sau bước lấy câu nguồn và reuse evidence. Chưa có key/model mà còn slot cần sinh/kiểm thì trả lỗi cấu hình rõ trước claim; không âm thầm dùng stub. Request chỉ có câu dữ liệu hoặc context đã kiểm phù hợp không cần key/model.
- Tối đa hai candidate mới mỗi slot, giới hạn concurrency và thời gian tổng; mỗi candidate được kiểm độc lập. Đổi câu sau thất bại, không cố sửa câu sai vô hạn. Quota một quiz như hiện tại; retry nội bộ không tăng lượt quota. Nếu không đủ câu hợp lệ, failure/recovery giữ cơ chế M11, không publish quiz thiếu câu hoặc nới validator.
- Chỉ lưu quiz/snapshot vào app; không tự thêm câu máy vào core.example hay coi như dữ liệu từ điển. Snapshot có source/model/prompt/validator version và validation evidence để truy vết. Dùng metadata này để tái sử dụng, xem §9.4; không gọi lại model cho mọi lượt quiz.

### 9.3 Thứ tự triển khai và gate

1. Contract styles/context, form resolver, đáp án/distractor và tests nền.
2. Context metadata/span/rendering/snapshot; repository câu nguồn và attribution.
3. Router dữ liệu/ngữ cảnh, reuse evidence, adapter generator/validator, cấu hình, bounded retries và quota/recovery.
4. Chấm pilot fixture và câu sinh cho hai Kanji styles: chỉ một đáp án, nghĩa đúng anchor sense, không lộ đáp án. Fail case phải trở thành regression fixture; chưa coi bước 1–2 là hoàn thành yêu cầu tự sinh câu.
5. Docs API/FE, build/lint/test và E2E local. Nếu thiếu key thì báo rõ chưa chạy pilot gọi thật; vẫn hoàn tất code/config/tests mock trước.

`context_vocabulary` (chọn từ điền vào câu), paraphrase và usage là nhánh mở rộng riêng sau hai Kanji styles. Yêu cầu nguồn dictionary + tự sinh câu được áp dụng ngay vào reading/orthography, không trì hoãn ngữ cảnh tới nhánh đó.

### 9.4 Tái sử dụng và giới hạn token

- Thứ tự chọn: câu nguồn có evidence phù hợp → câu đã sinh/kiểm trong pool snapshot → kiểm câu nguồn chưa có evidence → sinh và kiểm câu mới cho phần thiếu. Chọn ngẫu nhiên trong pool, tránh trùng sentence hash trong một bài khi đủ câu. Không ép mỗi lượt phải sinh câu mới để tạo cảm giác đa dạng.
- Đợt đầu đọc metadata từ các quiz ready gần đây trong cùng user/profile bằng query có giới hạn; không tạo bảng cache/core mới và không trả dữ liệu collection của người khác. Có thể chỉ chiếu phần metadata cần dùng, không đọc đáp án cả lịch sử vào response. Snapshot cũ bị xóa thì mất reuse, không ảnh hưởng làm bài đã lưu.
- Fingerprint semantic context gồm sense ID + input gloss hash, form/reading hợp lệ, sentence text hash, difficulty policy, source/version và validator policy version. Evidence về duy nhất một đáp án còn gồm style + các option text canonical sorted + correct answer text, không dùng index để tránh miss khi shuffle. Chỉ reuse evidence accepted, không reuse failed/unknown hoặc metadata chưa được parse theo schema.
- Model đang cấu hình đổi so với evidence thì cần kiểm lại. Khi tắt transport/model vẫn dùng evidence đã đạt policy và khớp nguồn/options; không làm cache miss chỉ vì credential không còn được cấu hình.
- Một câu có thể dùng cho cả reading và orthography nếu mỗi style có render/answer validation riêng. Evidence của một bộ distractor không tự chứng minh bộ distractor khác cũng chỉ có một đáp án đúng. Nếu câu hoặc options đổi, kiểm deterministic lại và kiểm semantic khi evidence không bao phủ.
- Có thể batch tối đa 5 slot cần sinh trong một request và batch kiểm riêng, mỗi slot có ID rõ; validate đủ IDs/không trùng/đúng target trước map về lịch quiz. Retry chỉ phần thất bại, trong budget hai candidate/slot và timeout tổng đã nêu. Các slot local không nằm trong payload.
- Ghi generator metadata nội bộ: số câu local, context reused, câu nguồn được kiểm, câu mới được sinh, số lần gọi, model và tokens_in/out thực tế. Usage provider không trả thì đánh dấu estimated thay vì coi 0; local/cache hit là 0. Không log key hoặc payload đầy đủ chứa dữ liệu người học.
- Quota lượt quiz hiện hữu là quy tắc sản phẩm riêng; không tự miễn quota cho câu local hay đổi entitlement. Báo cáo token phản ánh chi phí gọi model để sau này chủ dự án quyết định chính sách quota.

Nguồn tham chiếu: [cấu trúc JLPT](https://www.jlpt.jp/e/guideline/testsections.html). Các ví dụ trong plan tự soạn để minh họa feature, không sao chép đề thi.
