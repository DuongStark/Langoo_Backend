# DB4-D2/DB4-D4 — Nghiên cứu hướng mapping sense–concept

> Ngày: **07/10/2026**. Trạng thái: **tài liệu nghiên cứu, chưa chốt triển khai**.
> Phạm vi lượt này: lưu kết luận và nguồn tham khảo; không code, benchmark, gọi model hoặc ghi DB.
> Đọc cùng [plan DB4](db4-sense-concept-mapping.md), [contract v1](db4-schema-v1.md) và [handoff DB4-D1](../handoff/db4-d1.md).

## 1. Kết luận để đọc trước

**Trong các nguồn đã tra, chưa tìm được phương án thay thế có bằng chứng tốt hơn rõ ràng cho dữ liệu Langoo.** Hướng được khuyên chọn vẫn là kết hợp mapping theo danh tính nguồn, lọc candidate bằng thuật toán và dùng AI cho phần khó. Đây là đề xuất dựa trên tài liệu và cấu trúc dữ liệu hiện có, chưa phải kết quả thử trên Langoo.

Hai cải tiến đáng nghiên cứu thêm:

1. **So sánh các sense cạnh tranh của cùng từ** để phát hiện gắn nhầm hoặc gắn quá rộng, thay vì quyết định từng cặp riêng lẻ.
2. **Dùng quan hệ trong WordNet và các liên kết đã audit** để tăng chất lượng shortlist; giữ rõ khác biệt giữa gần nghĩa và cùng nghĩa.

Ưu tiên hoàn thiện một phạm vi hữu ích như JLPT N5/N4 trước. Chưa có lý do đủ mạnh để gửi toàn bộ backlog candidate cho AI. Muse là phương án provider có thể tận dụng, nhưng kết quả chọn nghĩa phổ biến ở M4.5/M10.5 **chưa chứng minh chất lượng mapping DB4**.

## 2. DB4 đang giải bài toán gì?

DB4 nối **sense cụ thể** với **concept cụ thể**. Ví dụ, hai sense của `bank` về ngân hàng và bờ sông phải được xét riêng. Trùng cách viết, POS hay một gloss ngắn chỉ giúp tìm candidate; không đủ kết luận `exact`.

Với tiếng Nhật, cần phân biệt hai việc:

- Một sense thuộc nguồn Japanese WordNet có danh tính synset có thể đối chiếu với hệ concept sau khi kiểm tra phiên bản và lineage.
- Một sense JMdict chưa có danh tính WordNet. Japanese WordNet có từ giống nó chỉ là chứng cứ để tìm candidate, không tự tạo ra mapping JMdict → concept.

Japanese WordNet được xây dựng trên synset Princeton WordNet; các công trình cập nhật cũng cho thấy cần xử lý biến thể từ và thông tin từ vựng. Điều đó không chứng minh hai bộ sense JMdict/WordNet có thể ghép một–một. [Japanese WordNet 2.0, 2023](https://aclanthology.org/2023.gwc-1.22/).

### Baseline dùng trong nghiên cứu

Đây là **snapshot local full ngày 06/10**, lấy lại từ [baseline đã lưu](../reviews/db4-baseline-2026-10-06.json), không phải kiểm kê VPS mới ngày 07/10.

| Dữ liệu                                        | Số lượng / ý nghĩa                                       |
| ---------------------------------------------- | -------------------------------------------------------- |
| Sense trong phạm vi JLPT                       | 15.245; chưa có link `sense_concept` tại snapshot        |
| Candidate JMdict → Japanese WordNet            | 45.219, phủ 13.079 sense JLPT                            |
| Sense JLPT chưa có candidate theo generator cũ | 2.166                                                    |
| Tổng semantic candidate pending                | 685.757; phần lớn thuộc nhánh EN Wiktextract             |
| Concept hiện hữu                               | 120.875, tất cả draft tại snapshot                       |
| Review LLM cũ                                  | 3.200 lượt; cần audit artifact/context trước tái sử dụng |

Các nhãn do model cũ trả không phải bộ đáp án chuẩn. Không dùng tỷ lệ `none`/`exact` của chúng để khẳng định precision của generator hoặc model.

## 3. So sánh các hướng

| Hướng                                            | Có ích ở đâu?                                                      | Giới hạn với Langoo                                                       | Đề xuất                              |
| ------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------ |
| Đối chiếu danh tính synset/ILI/sense key         | Tái sử dụng mapping nguồn WordNet đã audit, giảm gọi AI            | Phải đúng lexicon/version; không giải quyết trực tiếp sense JMdict        | Làm trước                            |
| Lọc lexical + truy hồi ngữ nghĩa + AI cho ca khó | Tận dụng EN gloss hiện có, giảm số cặp phải xét                    | Cần context đủ và cho phép unresolved; chưa đo chất lượng                 | Hướng chính                          |
| So sánh sense cùng từ, weighted b-matching       | Phát hiện cạnh tranh, kiểm tra giới hạn số liên kết                | Tối ưu score không chứng minh tương đương nghĩa                           | Bổ sung kiểm tra xung đột            |
| Graph alignment                                  | Khai thác synonym, hypernym/hyponym và anchor đã kiểm chứng        | Quan hệ graph có thể chỉ gần nghĩa; graph JMdict có thể thiếu             | Bổ sung cho shortlist                |
| Embedding/reranker hoặc classifier quan hệ       | Giảm số candidate; có thể chạy inference không cần LLM cho mọi cặp | Cần dữ liệu đánh giá đúng miền và đo tài nguyên; relevance khác exact     | Để mở, chưa chọn model               |
| Bộ mapping có sẵn / framework Naisc              | Tham khảo dữ liệu, thuật toán, tránh tự xây mọi thành phần         | Chưa tìm được bộ mapping sẵn phù hợp JMdict + nguồn/phiên bản Langoo      | Nguồn nghiên cứu, chưa thay pipeline |
| BabelNet                                         | Kho liên kết đa ngôn ngữ lớn                                       | Điều kiện sử dụng inter-resource links và API cần xem theo mục đích dự án | Chưa chọn làm nền mặc định           |

### 3.1 Mapping theo danh tính nguồn

Đối chiếu bằng lexicon + version + external synset/sense key; ILI chỉ dùng khi có mapping nguồn tương ứng. Không dùng numeric ID local làm danh tính chuyển sang VPS. Định dạng Global WordNet biểu diễn lexicon/version và ILI; nghiên cứu về permanent sense keys cung cấp hướng nối giữa các phiên bản WordNet. **Suy luận cho Langoo:** nhánh này giúp bảo toàn mapping nguồn, không thay cho alignment JMdict. [Global WordNet schemas](https://globalwordnet.github.io/schemas/), [Mapping Wordnets on the Fly, 2023](https://arxiv.org/abs/2303.01847).

### 3.2 Embedding và reranker

Bi-encoder phù hợp tìm một tập ứng viên nhỏ; cross-encoder xét chung hai văn bản để xếp lại tập đó. Tài liệu retrieve–rerank mô tả cách tiết kiệm chi phí so với chấm mọi cặp. **Suy luận cho DB4:** dùng chúng cho retrieval, không coi score similarity/relevance là xác suất `exact`. Chưa chọn model, ngưỡng hay cấu hình CPU/RAM. [Sentence Transformers: Retrieve & Re-Rank](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html).

Classifier phân loại `exact/broader/narrower/related/none` là một hướng khác với reranker tìm độ liên quan. Muốn thay AI bằng classifier cần mẫu chuẩn đúng miền JMdict–WordNet và kiểm tra calibration; không lấy một ngưỡng cosine tùy ý để tự accept.

### 3.3 Dữ liệu và công cụ có sẵn

- **Mapping Wiktionary–WordNet của Christian Meyer:** trang tác giả công bố bản alignment v1.2 ngày 01/10/2012 và bộ gold riêng. Có thể nghiên cứu hoặc dùng làm candidate nếu đối chiếu được snapshot/identity; không nhập như đáp án chuẩn cho dữ liệu Wiktextract hiện tại hay cho JMdict. [Trang dữ liệu tác giả](https://www.christian-meyer.org/publications/dissertation/data/?language=en).
- **Naisc:** framework linking có input RDF, cấu hình và training; repo dùng Java/Maven. Có thể tham khảo hoặc đánh giá sau khi làm adapter/export, chưa phải công cụ chạy ngay với contract DB4. Chưa cài hoặc thử trong nghiên cứu này. [Repo Naisc](https://github.com/insight-centre/naisc).
- **MWSA:** benchmark alignment giữa các từ điển đơn ngữ, với nhiều mức quan hệ nghĩa. Có ích để thiết kế rubric/classifier, nhưng không chứng minh có sẵn mapping JA–EN phù hợp Langoo. [MWSA benchmark, 2020](https://aclanthology.org/2020.lrec-1.395/).
- **BabelNet:** điều kiện dùng liên kết giữa các nguồn có ràng buộc non-commercial/research theo trang license; API cần key. Chưa xác lập phù hợp mục đích dùng của Langoo, nên chưa đề xuất thay nền dữ liệu. [License](https://babelnet.org/license), [API guide](https://babelnet.org/guide).

## 4. Pipeline được khuyên chọn

### Bước 1 — Audit và tái sử dụng chứng cứ nguồn

- Kiểm version/license/identity và artifact cũ; phân biệt link thực sự có lineage với flag `verified` trong DB.
- Tách mapping có thể đối chiếu bằng danh tính WordNet khỏi mapping cần suy luận phạm vi nghĩa.
- Giữ nguồn sở hữu link, semantic key và provenance. Không tự biến kết quả máy thành curated/verified.

### Bước 2 — Tạo context đúng sense

- Lấy toàn bộ EN gloss của sense JMdict cùng POS, reading/form restrictions, field/misc và thông tin nguồn có sẵn. JMdict có các trường ràng buộc và chú thích ở mức sense. [JMdict DTD](https://w.edrdg.org/jmdict/jmdict_dtd_h.html).
- Không chỉ lấy gloss đầu. Đồng thời không coi mỗi dòng gloss là một nhánh nghĩa riêng: chúng có thể là các cách diễn đạt tương đương.
- Gloss VI của DB3-B là bản dịch phụ thuộc EN; dùng cho báo cáo người đọc, không tính như một chứng cứ mapping độc lập.
- Concept context cần definition, lemma/synonym, POS và relation nguồn. Tách label ngắn khỏi definition.

### Bước 3 — Tìm và xếp candidate

- Tận dụng form/POS và EN gloss, giữ chứng cứ từng phương pháp retrieval.
- Có thể bổ sung embedding hoặc graph sau khi đánh giá; không bắt buộc dựng một dịch vụ ML mới từ đầu.
- Candidate qua shortlist phải có context đủ. Sense chưa có candidate được ghi unresolved và có đường tìm bổ sung, không bị bỏ khỏi denominator.
- Contract v1 giới hạn tối đa 5 ready candidate trong một sense bundle; không nhầm giới hạn này với số sense trong một request.

### Bước 4 — Kiểm tra cạnh tranh và phạm vi

So sánh các sense của cùng lexeme với nhóm concept cạnh tranh. Dùng kết quả để phát hiện một concept đang bị chọn cho nhiều sense với phạm vi khác nhau hoặc một sense rộng đang bị ép vào concept hẹp. Việc nhiều sense cùng concept tự nó không phải lỗi; cần đọc phạm vi nghĩa.

Đây là lớp kiểm tra đề xuất, chưa có shape artifact trong contract v1. Không ghép/tách sense JMdict hoặc concept để làm cho thuật toán dễ khớp.

### Bước 5 — AI xử lý phần chưa đủ chứng cứ

- Muse có thể là provider thay OpenCode đã được người dùng bỏ, nhưng cần adapter và đánh giá DB4 riêng.
- Có thể gom **3–5 sense bundle độc lập/request** để giảm overhead. Đây là ý tưởng chưa đo; batch phải giới hạn theo context thực tế, giữ ID/hash từng bundle và cách xử lý output thiếu/nhầm ID.
- Không chọn số worker DB4 dựa riêng trên tốc độ job ranking. Nếu dùng cùng tài khoản Muse, cần lịch/cap dùng chung trước chạy đồng thời.
- Cho phép `uncertain`/không có concept phù hợp; không buộc model chọn một candidate chỉ để tăng coverage.
- Theo contract hiện hành, AI `accept_exact` vẫn cần hai lượt R1/R2 đủ gate. Ý tưởng chỉ review bổ sung một phần ca khó phải được chốt thành policy/contract mới trước khi dùng.

### Bước 6 — Lưu artifact và promote có điều kiện

Lưu candidate, context, raw response, decision và provenance theo semantic identity/hash. Acceptance mapping, apply DB và đưa nghĩa vào API là các trạng thái riêng. `exact` được chấp nhận không tự đổi concept draft thành curated hay mở serving; tiếp tục guard/journal/rollback của plan DB4.

## 5. Hai cải tiến nên nghiên cứu sâu hơn

### 5.1 So sánh các sense cùng từ

Nghiên cứu weighted bipartite b-matching mô hình hóa alignment như đồ thị hai phía với giới hạn số liên kết, thay vì bắt buộc ghép một–một. Điều này phù hợp khi hai từ điển chia nghĩa khác nhau. Công trình đã nghiên cứu WordNet–Wiktionary, chưa chứng minh hiệu quả trên JMdict của Langoo. [Lexical Sense Alignment Using Weighted Bipartite b-Matching, 2019](https://ceur-ws.org/Vol-2402/paper3.pdf).

**Ứng dụng đề xuất:** thêm kiểm tra xung đột hoặc rerank trong nhóm sense. Giữ nguyên v1: tối đa một link exact mới/sense, kiểm existing exact trước promote; các relation khác lưu ở artifact/candidate trước khi có serving policy. Không đặt ràng buộc một concept chỉ được dùng bởi một từ trên toàn DB, và không tự accept nghiệm tối ưu của đồ thị.

### 5.2 Thêm chứng cứ graph

Dijkstra-WSA khai thác cấu trúc graph để alignment WordNet với các tài nguyên khác, kết hợp gloss backoff. Bài báo cho thấy graph là hướng khả thi trên những bộ dữ liệu được nghiên cứu; không có benchmark JMdict–Langoo trong kết quả đó. [Dijkstra-WSA, 2013](https://aclanthology.org/Q13-1013/).

**Ứng dụng đề xuất:** dùng synonym/hypernym/hyponym và anchor đã audit để tìm thêm candidate hoặc phát hiện phạm vi rộng/hẹp. Khoảng cách graph thấp không đồng nghĩa `exact`. Khi graph nguồn thiếu, giữ đường retrieval EN gloss. Không lan truyền các accept yếu rồi tính chúng như chứng cứ độc lập trong cùng run.

## 6. Triển khai theo phạm vi nào khi được chốt?

| Đợt đề xuất                     | Đầu ra cần đạt                                               | Lý do                                                  |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| JLPT N5/N4                      | Mapping hoặc unresolved có lý do cho từng sense trong cohort | Phạm vi hữu ích, dễ xem lỗi trước mở rộng              |
| Phần JLPT còn lại               | Mở rộng generator/gate từ lỗi đã quan sát                    | Không gửi toàn bộ backlog ngay từ đầu                  |
| EN Wiktextract và JA ngoài JLPT | Alignment theo source/version riêng                          | Khối lượng và cách chia nghĩa khác; cần đánh giá riêng |

Chưa có ước lượng đáng tin về số request, thời gian, tỷ lệ exact hoặc RAM cho DB4. Các phép đo Muse ranking là dữ liệu vận hành tham khảo, không phải benchmark mapping. Không đề xuất đặt thêm embedding/reranker nặng trên VPS đang chạy app/Muse trước khi đo tài nguyên.

Khi chủ dự án quyết định tiếp tục, thứ tự nên là: đối chiếu code/artifact của luồng DB4 hiện có → chốt thay đổi contract nếu cần → hoàn thiện retrieval/context → đánh giá cohort nhỏ → mới mở rộng. Tài liệu này không xác nhận trạng thái triển khai của luồng khác.

## 7. Những điểm còn cần quyết định

| Nội dung               | Hiện hành / điều đã biết                         | Đề xuất còn mở                                                                                    |
| ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Semantic review        | DB4-D1 yêu cầu R1/R2 cho AI `accept_exact`       | Có giảm lượt review theo nhóm rủi ro hay giữ hai lượt? Cần căn cứ chất lượng và cập nhật contract |
| Provider               | Job ranking đã thử Muse; chưa chứng minh mapping | Chọn adapter Muse riêng và lịch dùng cùng tài khoản                                               |
| Batch                  | Contract theo sense bundle, tối đa 5 candidate   | Nhiều bundle/request cần envelope/correlation/repair phù hợp                                      |
| Graph/joint comparison | Chưa có contract đầu ra cho lớp bổ sung          | Dùng làm evidence/rerank/conflict check, tránh tự promote theo score                              |
| Embedding/classifier   | Chưa chọn model/ngưỡng, chưa đo VPS              | Chỉ bổ sung khi retrieval hiện có bộc lộ vấn đề cụ thể                                            |
| Nghiệm thu             | Không có gold Langoo từ các nhãn LLM cũ          | Xác định rubric và tập kiểm chứng độc lập trước coi score là precision                            |

**Không thay đổi policy/contract bằng tài liệu này.** Quyền lấy trực tiếp kết quả Muse không recheck của job ranking M10.5/M4.5 không được tự áp sang DB4. Chưa có bộ mapping sẵn được xác minh có thể thay toàn bộ quá trình; cũng không kết luận rằng bộ như vậy không tồn tại ở nơi khác.

## 8. Thứ tự đọc tham khảo

1. [Plan DB4 §5–8](db4-sense-concept-mapping.md#5-ngữ-nghĩa-relation-và-cardinality): hiểu bài toán phạm vi nghĩa và context của Langoo.
2. [Contract v1](db4-schema-v1.md): hiểu những gì tooling hiện tại đã cố định.
3. [Retrieve & Re-Rank](https://www.sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html): hiểu cách giảm tập candidate trước bước quyết định.
4. [Weighted b-matching](https://ceur-ws.org/Vol-2402/paper3.pdf): hướng so sánh nhóm nghĩa cùng từ.
5. [Dijkstra-WSA](https://aclanthology.org/Q13-1013/): hướng bổ sung chứng cứ graph.

## 9. Nhật ký tài liệu

### 2026-10-07 — DB4-D2/DB4-D4 — Nghiên cứu hướng mapping sense–concept

- Thay đổi / lý do: lưu nghiên cứu bổ sung và đề xuất hybrid để chủ dự án đọc dần sau khi bỏ provider OpenCode vì chậm.
- File / phạm vi: tài liệu này; thêm liên kết trong plan DB4 và entry `PROGRESS.md`.
- Kiểm tra / kết quả: kiểm tra Markdown, liên kết file nội bộ và whitespace; kết quả cuối ghi trong `PROGRESS.md`. Không chạy test code/benchmark/provider.
- Gate còn thiếu: lựa chọn hướng, source audit mới, đối chiếu công việc luồng DB4, thiết kế adapter/contract và đánh giá chất lượng; chưa triển khai các đề xuất mới.
- Git / triển khai: tài liệu lưu local, chưa commit/push; không sửa DB, VPS, service hoặc job Muse đang chạy.
