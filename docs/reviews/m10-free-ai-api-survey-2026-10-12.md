# M10 — Khảo sát API AI miễn phí và credit thử nghiệm cho Langoo

Ngày khảo sát: **2026-10-12**. Phạm vi: nghiên cứu nguồn công khai, ưu tiên tài liệu chính thức; không tạo tài khoản, gọi inference, đổi provider hay chạy job DB. Không thể bảo đảm danh sách bao phủ mọi website hoặc ưu đãi riêng theo tài khoản/quốc gia.

Quốc gia bên dưới là thị trường/xuất xứ nhà cung cấp, không có nghĩa chỉ công dân nước đó được sử dụng. Điều kiện đăng ký từ Việt Nam, thẻ, xác minh danh tính và quota thực nhận cần kiểm tra trong console; chỉ Gemini đã tìm được Việt Nam trong danh sách khu vực hỗ trợ chính thức. Chưa benchmark tốc độ hoặc chất lượng Nhật–Việt.

## 1. Những lựa chọn nên thử trước

Đây là thứ tự đề xuất theo khả năng tiếp cận, model/catalog và quota công bố, không phải bảng xếp hạng chất lượng đã đo:

1. **Gemini Developer API:** phù hợp chat có ảnh và quiz; pricing có free tier cho Gemini Flash. Quota theo project/tài khoản. Free tier có điều khoản dùng dữ liệu để cải thiện sản phẩm.
2. **Groq:** GPT-OSS-120B là lựa chọn text đáng thử cho quiz/job nhỏ. Free tier có cả giới hạn request và token; prompt dài sẽ hết token trước request.
3. **Z.AI:** GLM-4.7-Flash cho text, GLM-4.6V-Flash cho ảnh có giá inference bằng 0; vẫn cần kiểm quota/concurrency tài khoản.
4. **Alibaba Model Studio International/Singapore:** trial theo từng model, 90 ngày; bật Free Quota Only trước khi chạy. Không áp quota thử cho Batch API.
5. **Scaleway:** một triệu token đầu cho khách hàng mới; đủ để đối chiếu chất lượng một tập mẫu, không phải nguồn miễn phí lâu dài.
6. **Microsoft for Startups:** nếu Langoo đủ điều kiện thì credit lớn hơn các trial thông thường; cần thẻ và xác minh để nhận mức bổ sung.

## 2. Free tier định kỳ hoặc model có giá 0

| Nhà cung cấp / thị trường | Ưu đãi đã tìm được | Model hoặc tác dụng | Điều kiện / giới hạn | Nguồn chính thức |
|---|---|---|---|---|
| Google Gemini / Mỹ | Free input/output trên các dòng model được đánh dấu free; pricing hiện có Gemini 3.8 Flash | Text, ảnh; phù hợp chat/quiz | Quota thực tế xem AI Studio; không lấy RPM/RPD cũ làm cam kết. Việt Nam được hỗ trợ. Dữ liệu free tier có thể dùng cải thiện sản phẩm | [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [limits](https://ai.google.dev/gemini-api/docs/rate-limits), [regions](https://ai.google.dev/gemini-api/docs/available-regions) |
| Groq / Mỹ | GPT-OSS-120B: 30 RPM, 1.000 RPD, 8.000 TPM, 200.000 TPD | GPT-OSS-120B; catalog có Qwen3.8-27B | Các giới hạn áp dụng đồng thời; mức tài khoản có thể khác. GPT-OSS là text, không dùng cho ảnh | [Limits](https://console.groq.com/docs/rate-limits), [models](https://console.groq.com/docs/models) |
| Z.AI / Trung Quốc | Input/output free: GLM-4.7-Flash, GLM-4.5-Flash, GLM-4.6V-Flash | Text và vision với dòng 4.6V | Free không có nghĩa vô hạn. FlashX/GLM lớn khác vẫn tính phí; cột storage cache free không phải inference free | [Pricing](https://docs.z.ai/guides/overview/pricing) |
| Mistral / Pháp | API Free mode, không cần thẻ | Model được tài khoản Studio cho phép | Có rate/usage cap; chưa xác minh được số $10/tháng hay một tỷ token/tháng trong tài liệu hiện hành | [Activate API key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), [subscriptions](https://docs.mistral.ai/admin/billing-usage/subscriptions) |
| OpenRouter / Mỹ | Catalog có model `:free` | Nemotron-3-Ultra-550B-A55B, Nemotron-3-Super-120B-A12B, Gemma-4-31B-IT, Gemma-4-26B-A4B-IT | GET catalog xác nhận metadata/giá 0, chưa gọi inference. Quota free theo account/key; chưa xác minh số quota cụ thể từ bảng official hiện hành | [Free models](https://openrouter.ai/collections/free-models/), [catalog API](https://openrouter.ai/api/v1/models), [limits](https://openrouter.ai/docs/api_reference/limits) |
| Cloudflare Workers AI / Mỹ | 10.000 Neurons/ngày, reset 00:00 UTC | Model được free plan hỗ trợ | Neurons không phải token; một số model đòi paid plan | [Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Vercel AI Gateway / Mỹ | $5/tháng free | Một phần catalog thuộc free tier | Tài liệu mới chỉ cho free một tập model. Mua credit chuyển paid tier và ngừng credit free hàng tháng; không mặc định có thể gọi Claude/GPT bất kỳ bằng $5 free | [Pricing](https://vercel.com/docs/ai-gateway/pricing), [free catalog filter](https://vercel.com/ai-gateway/models?freeTier=true) |
| Kilo Gateway | Model `:free`; anonymous 200 request/giờ/IP | API gateway, thiên về coding | Một số model yêu cầu data collection; chưa kiểm terms cho job Langoo số lượng lớn | [Authentication](https://kilo.ai/docs/gateway/authentication), [billing](https://kilo.ai/docs/gateway/usage-and-billing) |
| Sakura AI Engine / Nhật | 3.000 request chat/tháng; embedding 10.000 request/tháng | GPT-OSS-120B, llm-jp-3.1-8x13b-instruct4; multilingual-e5-large | Cần đăng ký cloud/thẻ. Chưa xác minh người dùng Việt Nam đăng ký được; quota request không phải token | [Product/quota](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) |
| Hugging Face Inference Providers | $0,10/tháng cho free user | Nhiều provider/model qua HF | Rất nhỏ, chủ yếu smoke test; lượng credit có thể đổi | [Pricing](https://huggingface.co/docs/inference-providers/en/pricing) |

## 3. Credit/token thử nghiệm khi đăng ký

| Nhà cung cấp / thị trường | Mức công bố | Cần chú ý | Nguồn chính thức |
|---|---|---|---|
| Alibaba Model Studio / Singapore, Trung Quốc | Free quota theo model, hiệu lực 90 ngày | Region Singapore + International; cần hoàn tất thông tin tài khoản. Free Quota Only mặc định tắt, có thể tính PAYG sau khi hết. Không khẳng định một số token chung cho mọi Qwen | [New free quota](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/new-free-quota), [model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing) |
| Scaleway / Pháp | 1.000.000 token cho khách hàng mới | Hết quota bắt đầu tính phí. Catalog có GLM-5.2, DeepSeek-V4-Flash, Qwen3.8-27B; chưa đo chất lượng | [Generative APIs](https://www.scaleway.com/en/generative-apis/) |
| SiliconFlow International | $1 credit khởi đầu | Dùng `.com`; không gộp ưu đãi nhân dân tệ của `.cn` vào tài khoản quốc tế | [Pricing](https://www.siliconflow.com/pricing) |
| Cerebras / Mỹ | $5 promo, hết hạn sau 30 ngày | Cần payment method hợp lệ. Promo hết thì tạm ngừng nếu chưa mua PAYGO riêng; không phải free tier vĩnh viễn | [Pricing](https://www.cerebras.ai/pricing) |
| Inception / Mỹ | 10 triệu token với API key mới theo trang models hiện hành | Blog chiến dịch từng ghi 100 triệu; không lấy số cũ làm cam kết. Mercury cần benchmark riêng cho Nhật–Việt | [Models](https://www.inceptionlabs.ai/models) |
| Sarvam / Ấn Độ | ₹100 signup credit | FAQ mới khác các video cũ ghi ₹1.000; model thiên về ngôn ngữ Ấn Độ, chưa đo Nhật–Việt | [Limits/signup credit](https://docs.sarvam.ai/api/getting-started/ratelimits), [API pricing](https://www.sarvam.ai/api-pricing) |
| Novita | Referral hợp lệ: $10 cho mỗi bên | Trần $500 là tổng chương trình referral, không phải mỗi người đăng ký tự nhận $500 | [Referral](https://novita.ai/referral/) |
| BytePlus ModelArk / Singapore | Trang free quota công bố 500.000 token và Free Tokens Only Mode | Online inference theo model; không áp Batch/plugins/storage. Cần kiểm console chi tiết. Chiến dịch 5 triệu/ngày cũ đã ghi kết thúc 08/10/2026 | [Free quota](https://docs.byteplus.com/en/docs/modelark/free-inference-quota?redirect=1), [collaboration reward](https://docs.byteplus.com/en/docs/modelark/collaboration-reward-program?redirect=1) |
| Volcengine Ark / Trung Quốc | 500.000 token; Free Tokens Only Mode | Cần kiểm yêu cầu tài khoản/danh tính Trung Quốc. Không suy ra người dùng Việt Nam có cùng quyền lợi | [Free mode](https://docs.volcengine.com/docs/ark/free-tokens-only-mode?lang=zh) |
| Fireworks / Mỹ | FAQ còn mô tả trial credit $1 | Chưa chứng minh mọi account mới đều được cấp hiện nay; cần xác nhận console. Hết credit không có payment method thì service dừng | [FAQ](https://docs.fireworks.ai/faq-new/billing-pricing/what-happens-when-i-finish-my-1-dollar-credit), [docs index](https://docs.fireworks.ai/llms.txt) |
| Nebius Token Factory / Hà Lan | Có chương trình credit/builders/certification | Chưa xác minh mức signup chung; đường dẫn billing cũ đã lỗi. Không cam kết $1/$10 chỉ dựa blog ngoài | [Academy](https://nebius.com/academy/agentic-ai), [certification](https://nebius.com/certification/agentic-ai) |

## 4. Evaluation và chương trình cần xét duyệt

| Nhà cung cấp / thị trường | Cơ hội | Giới hạn áp dụng | Nguồn chính thức |
|---|---|---|---|
| NVIDIA Build/NIM / Mỹ | Free serverless for development; catalog có Kimi-K3, DeepSeek-V4-Pro, Nemotron-3-Ultra | Terms trial cho development/evaluation, có throttle. Cần xem quyền dùng trước khi chạy enrichment DB production; không cam kết quota 1.000 credit cũ | [Catalog](https://build.nvidia.com/explore), [trial terms](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf) |
| Cohere / Canada | Trial 1.000 call/tháng; nhiều chat endpoint 20 RPM | Trial/POC; production key khác. Catalog có Command A/Reasoning/Translate/Vision nhưng chưa test thực tế | [Rate limits](https://docs.cohere.com/v2/docs/rate-limits), [FAQ](https://docs.cohere.com/docs/cohere-faqs) |
| Microsoft for Startups / Mỹ | $1.000/90 ngày; thêm $4.000/180 ngày sau xác minh doanh nghiệp | Account Azure mới, thẻ, điều kiện chương trình. Credit Azure không tự động thanh toán mọi model marketplace | [FAQ](https://learn.microsoft.com/en-us/startups/microsoft-for-startups/mfs-faqs) |
| Google for Startups / Mỹ | Early-stage tới $2.000; funded AI startup tới $350.000 | Có điều kiện funding/program; năm sau có phần đồng chi trả. Không phải signup miễn phí cho mọi cá nhân | [Early-stage](https://cloud.google.com/startup/early-stage), [program](https://cloud.google.com/startup) |
| OVHcloud / Pháp | Trial Public Cloud credit có thể dùng AI Endpoints | Mức credit phụ thuộc thị trường/tài khoản; không lấy mức Australia làm mức toàn cầu. Free alpha 2024 không chứng minh inference free hiện nay | [AI API trial](https://www.ovhcloud.com/pt/public-cloud/free-ai-api/) |
| Baidu Qianfan / Trung Quốc | Đăng ký trial flagship model | Form yêu cầu thông tin doanh nghiệp/real-name/điện thoại; quota phải xét duyệt | [Trial form](https://cloud.baidu.com/survey/flagship-model.html) |
| GMI Cloud | Chương trình/endpoint free theo chiến dịch | Một số ưu đãi yêu cầu balance hoặc doanh nghiệp được duyệt; chưa xác nhận free endpoint còn chạy hiện nay. Không dùng blog cũ để cam kết quota | [Free testing blog](https://www.gmicloud.ai/en/blog/where-to-get-free-h100-gpu-credits-for-ai-testing-and-model-benchmarking), [Qwen Day](https://www.gmicloud.ai/qwen-day) |
| Yandex Cloud / Nga | Cloud trial grant có phần dùng Foundation Models | Điều kiện quốc gia/account và phần grant áp được cần kiểm; chưa xác minh đăng ký từ Việt Nam | [Cloud trial](https://yandex.cloud/en/cloud-credits-for-trial) |
| Tencent Hunyuan / Trung Quốc | API dịch: 1 triệu token trong một năm | Là translation API, chưa xác minh hỗ trợ JA–VI; không thay thế general LLM chọn candidate | [Translation pricing/quota](https://intl.cloud.tencent.com/zh/document/product/1284/77186) |

## 5. Embedding/rerank để giảm tải DB4

- **Voyage AI:** một số model mới có 200 triệu token đầu miễn phí; nhóm khác 50 triệu, theo từng model. Batch API tính phí riêng và **không dùng free quota**. [Pricing](https://docs.voyageai.com/docs/pricing).
- **Jina AI:** có free API key tier, bảng hiện hành nêu 100 RPM/100.000 TPM cho embedding/rerank. Chưa xác minh được allocation token tổng 10 triệu trong trang pricing hiện hành nên không cam kết. [Pricing](https://jina.ai/api-dashboard/pricing/), [API docs](https://api.jina.ai/docs).
- **Sakura:** multilingual-e5-large theo request/tháng như §2, nhưng eligibility từ Việt Nam chưa xác minh.

Embedding/rerank chỉ thu hẹp và sắp candidate; không chứng minh hai sense tương đương. Muốn đổi MiniLM đang dùng cần đánh giá trên fixture DB4 trước.

## 6. Những thông tin cũ không nên dùng để lập ngân sách

| Tên | Kết quả khảo sát hiện tại | Nguồn |
|---|---|---|
| Together AI | Không còn free trial; lần nạp đầu tối thiểu $15 | [Billing](https://docs.together.ai/docs/billing-credits) |
| SambaNova | Trang plans hiện yêu cầu payment method và mua credit; bài $5 trial cũ chưa chứng minh ưu đãi còn áp dụng | [Plans](https://cloud.sambanova.ai/plans) |
| GitHub Models | Đã ngừng ngày 30/07/2026 | [Official retirement](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/) |
| LongCat | Chưa xác minh 500.000 token/ngày còn áp dụng; LongCat 2.5 hiện có bảng PAYG | [Pricing](https://longcat.chat/platform/docs/pricing/longcat-2.5), [FAQ](https://longcat.chat/platform/docs/faq) |
| ModelScope | Có thông báo cũ 2.000 API/ngày; chưa xác nhận quota hiện hành trong console | [Announcement](https://www.modelscope.cn/headlines/article/838), [docs](https://modelscope.cn/docs/model-service/API-Inference/intro) |
| Claude for Startups | Trang hiện nói oversubscribed/review lại offer; không bảo đảm mỗi signup được $1.000 | [Program](https://claude.com/programs/startups) |
| Google Cloud $300 trial | Từ 03/2026 không dùng credit này cho Gemini Developer API/AI Studio; không suy rộng thành mọi dịch vụ Vertex AI | [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) |
| Upstage / Hàn Quốc | Chưa xác minh signup credit LLM chung. Free agent runs không phải token Solar API; ưu đãi học thuật có điều kiện | [API pricing](https://www.upstage.ai/pricing/api) |

Đã dò thêm FriendliAI, Hyperbolic, DeepInfra, AI21, Moonshot, MiniMax, Xiaomi MiMo, Chutes, Inference.net, Ollama và NanoGPT nhưng chưa có bằng chứng hiện hành đủ chắc để đưa vào nhóm miễn phí/credit signup. Không tìm thấy không đồng nghĩa chắc chắn không có ưu đãi riêng. Free gateway request cũng không có nghĩa token model miễn phí.

## 7. Hướng tận dụng cho Langoo

- **Chat có ảnh:** kiểm Gemini Flash và GLM-4.6V-Flash trước. Không dùng GPT-OSS cho ảnh.
- **Quiz/text nhanh:** Groq và Gemini Flash đáng làm cùng một benchmark nhỏ. Chưa có số latency đo trong khảo sát này.
- **DB4 chọn candidate:** ưu tiên model mạnh có credit/quota đủ và giữ model/version/prompt cố định cho mỗi đợt. Provider miễn phí không tự giải quyết lỗi semantic hay contract; cần các gate hiện có của DB4.
- **Khối lượng lớn:** Gemini/Groq có quota định kỳ; Alibaba có trial theo model; Microsoft startup credit nếu đủ điều kiện. Không tính quota free bằng số API key — nhiều key cùng account/project thường dùng chung hạn mức.
- **Chi phí:** bật chế độ dừng khi hết free quota nếu có; đặt ngân sách/token cap và ghi provider/model provenance trước khi chạy. Không coi giá 0 là SLA hay throughput vô hạn.
- Không đổi runtime Muse/Qwen, không triển khai fallback, không tạo nhiều tài khoản để nhân quota trong phiên nghiên cứu.

## 8. Kiểm tra, gate và trạng thái

- Phạm vi file: tài liệu này và entry khảo sát M10 trong `PROGRESS.md`.
- Đã đọc/search tài liệu chính thức và đối chiếu ưu đãi cũ; một số site JS cần dùng nội dung official đã index hoặc HTTP HTML. GET OpenRouter catalog chỉ là đọc metadata, không phải kiểm inference.
- Gate còn thiếu: eligibility tài khoản thực, quota console, terms cho production, benchmark JA–VI/JSON/ảnh/latency, cơ chế khóa chi phí.
- Không chạy test/build vì chỉ nghiên cứu tài liệu; kiểm diff/format và đường dẫn tài liệu sau khi lưu.
- Git/triển khai: chưa commit, chưa push; không deploy hoặc thay cấu hình VPS.

## 9. 2026-10-13 — M10 — Kiểm tra Devora Events

- Nguồn: [Events/FAQ](https://devora.my.id/events), [homepage/catalog](https://devora.my.id/).
- Devora tự giới thiệu là AI gateway. Snapshot homepage được search index đọc hôm nay liệt kê Space Bunny (`devora-01/stealth/space-bunny`) và DeepSeek V4.1 Flash (`devora-01/deepseek/deepseek-v4.1-flash`), đều input/output free. Context 1M; Space Bunny có nhãn vision/reasoning/tools, DeepSeek có reasoning/tools. Snapshot có event FREE V4.1 FLASH với nhãn còn 7 ngày; đây chưa phải xác nhận thời điểm kết thúc live.
- FAQ: model event dùng ngân sách token; hết ngân sách trở về giá niêm yết. Request được nhận khi event đang chạy vẫn free dù event kết thúc giữa stream. Chưa rõ quota riêng từng account; chưa thấy mức signup credit được xác nhận.
- Kiểm tra: HTTP GET HTML/public JS và web search; trang Events tải danh sách phía client. Endpoint public mà frontend dùng `/backend/api/v1/events` trả HTTP 403 khi đọc; không có browser khả dụng. Vì vậy chưa xác nhận budget còn lại, dates, API base URL, rate/concurrency, model upstream thật hoặc chất lượng. Chưa gọi inference/đăng ký/nạp tiền.
- Nhận định: có thể đưa vào danh sách thử cho job có checkpoint; chưa đủ bằng chứng làm provider duy nhất cho production. Nhãn 1M là context, không phải một triệu token tặng mỗi account. Tên model là claim của Devora, chưa xác minh từ nhà cung cấp upstream.
- File/phạm vi: tài liệu khảo sát M10 và `PROGRESS.md`; không đổi code/config/runtime. Git: docs chưa commit/chưa push; không deploy. Gate còn thiếu: console live + terms + inference benchmark.

### Cập nhật sau khi gọi thật bằng key chủ dự án cung cấp

- [M10 — Devora API smoke](m10-devora-api-smoke-2026-10-13.md): GET models 200. Space Bunny inference 403 `plan_required`, yêu cầu SUBSCRIPTION trong khi account STANDARD; chưa thử ảnh. DeepSeek 200, đúng 6/6 mẫu đơn giản, response đầy đủ mất 67,120 giây; chưa benchmark DB4.
- Catalog authenticated niêm yết DeepSeek 400/1.000 credits/M token input/output. Một lượt được phép tối đa 1 credit; quy đổi usage danh nghĩa 0,4324 credit, chưa xác nhận actual billing/event free. Không đổi runtime hay chạy lớn.

- Sau khi chủ dự án cho phép bỏ cap credit/token, [test 8 luồng](m10-devora-8workers-2026-10-13.md) ghi nhận 21/24 request thành công; 3 lỗi 502 đều phục hồi sau retry. Median lượt thành công 11,026 giây, max 38,092; chưa thấy 429. Đây là fixture tổng hợp đơn giản, chưa kiểm chất lượng DB4 hoặc miễn phí thực tế.
