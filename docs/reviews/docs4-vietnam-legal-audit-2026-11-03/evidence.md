# DOCS4 — Bằng chứng công khai tại 2026-11-03

Đây là trích xuất tĩnh từ JavaScript đang được langoo.org phục vụ; chưa phải kết quả render/E2E. Hash và URL trong evidence.json. Frontend local cũ hơn bản công khai.

## Chính sách quyền riêng tư tiếng Việt

```text
x={vi:{title:"Chính sách quyền riêng tư",intro:`Langoo (https://langoo.org) là ứng dụng học từ vựng tiếng Anh và tiếng Nhật do ${a.vi} vận hành. Chính sách này giải thích chúng tôi thu thập dữ liệu gì, dùng vào việc gì, chia sẻ với ai và bạn có những quyền gì đối với dữ liệu của mình.`,sections:[{heading:"1. Dữ liệu chúng tôi thu thập",bullets:["Thông tin tài khoản: địa chỉ email, tên hiển thị, ảnh đại diện (nếu có) và mật khẩu. Mật khẩu chỉ được lưu dưới dạng băm, chúng tôi không đọc được mật khẩu gốc.","Khi bạn đăng nhập bằng Google: chúng tôi chỉ nhận từ Google địa chỉ email, tên, ảnh đại diện và mã định danh tài khoản Google (phạm vi openid, email, profile). Langoo không truy cập Gmail, Google Drive, danh bạ hay bất kỳ dữ liệu Google nào khác.","Dữ liệu học tập: hồ sơ học, sổ tay và từ vựng bạn lưu, lịch sử ôn tập và làm quiz, lịch hoạt động (chuỗi ngày học), lịch sử tra từ và các cài đặt như múi giờ, mục tiêu hằng ngày.","Nội dung bạn gửi: tin nhắn với Trợ lý AI (kèm ảnh nếu bạn đính kèm), góp ý và ảnh chụp màn hình gửi kèm, báo cáo lỗi nghĩa của từ.","Thông tin kỹ thuật: loại nền tảng và phiên bản ứng dụng khi đăng nhập, nhật ký truy cập của máy chủ (thời điểm, địa chỉ IP) phục vụ bảo mật và chống lạm dụng, thống kê lượt xem trang ẩn danh không dùng cookie (Vercel Web Analytics)."]
},{heading:"2. Dữ liệu chỉ nằm trên thiết bị của bạn",bullets:["Tệp PDF bạn mở trong tính năng Đọc PDF được xử lý hoàn toàn trên trình duyệt và không được tải lên máy chủ của chúng tôi.","Trình duyệt lưu khoá phiên đăng nhập (refresh token), lựa chọn giao diện, ngôn ngữ và bộ nhớ đệm để ứng dụng chạy nhanh và dùng được khi ngoại tuyến. Bạn có thể xoá bằng cách đăng xuất hoặc xoá dữ liệu trang web trong trình duyệt."]
},{heading:"3. Mục đích sử dụng",bullets:["Tạo và bảo vệ tài khoản, cho phép bạn đăng nhập trên nhiều thiết bị.","Cung cấp các tính năng: tra từ, lưu từ, lịch ôn tập lặp lại ngắt quãng, quiz, thống kê và lịch hoạt động, Trợ lý AI.","Phản hồi góp ý, sửa lỗi dữ liệu từ điển và cải thiện chất lượng ứng dụng.","Phát hiện và ngăn chặn truy cập trái phép, gian lận hoặc lạm dụng hệ thống."],paragraphs:["Chúng tôi không bán dữ liệu cá nhân, không dùng dữ liệu của bạn cho quảng cáo và không cho bên thứ ba dùng dữ liệu của bạn để quảng cáo."]
},{heading:"4. Dữ liệu người dùng Google",paragraphs:["Việc Langoo sử dụng và chuyển giao thông tin nhận được từ Google API tuân thủ Chính sách dữ liệu người dùng của Dịch vụ API Google (Google API Services User Data Policy), bao gồm các yêu cầu về Sử dụng giới hạn (Limited Use).","Email, tên và ảnh đại diện từ Google chỉ được dùng để tạo và đăng nhập tài khoản Langoo của bạn. Chúng tôi không chuyển dữ liệu này cho bên thứ ba, ngoại trừ khi pháp luật yêu cầu, và không dùng để huấn luyện mô hình AI.","Bạn có thể thu hồi quyền truy cập của Langoo bất cứ lúc nào tại https://myaccount.google.com/permissions."]
},{heading:"5. Bên thứ ba xử lý dữ liệu",bullets:["Google: dịch vụ Đăng nhập bằng Google.","Vercel: lưu trữ trang web và thống kê lượt truy cập ẩn danh.","Nhà cung cấp máy chủ (VPS): lưu trữ máy chủ API và cơ sở dữ liệu.","Nhà cung cấp mô hình ngôn ngữ (hiện tại là Groq): nhận nội dung tin nhắn Trợ lý AI và từ vựng dùng để tạo câu hỏi quiz, chỉ để tạo câu trả lời cho bạn.","Dịch văn bản: văn bản bạn dịch được gửi trực tiếp từ trình duyệt tới dịch vụ dịch (Google Translate hoặc MyMemory), hoặc được dịch ngay trên thiết bị nếu trình duyệt hỗ trợ. Ảnh bạn chọn để đọc chữ được nhận dạng ngay trên thiết bị và không được gửi đi; chỉ phần chữ đọc được mới được dịch như trên."]
},{heading:"6. Lưu trữ và bảo mật",paragraphs:["Mọi kết nối đều được mã hoá bằng HTTPS. Mật khẩu được băm; khoá truy cập ngắn hạn chỉ nằm trong bộ nhớ trình duyệt và được làm mới định kỳ. Quyền truy cập máy chủ được giới hạn cho người vận hành. Không có hệ thống nào an toàn tuyệt đối, nhưng chúng tôi áp dụng các biện pháp hợp lý để bảo vệ dữ liệu của bạn."]
},{heading:"7. Thời gian lưu và xoá dữ liệu",paragraphs:["Dữ liệu được lưu khi tài khoản của bạn còn hoạt động. Để xoá tài khoản cùng toàn bộ dữ liệu liên quan, hãy gửi email tới "+t+" từ địa chỉ email của tài khoản. Chúng tôi sẽ xác nhận và xoá trong vòng 30 ngày; bản sao lưu được xoá theo chu kỳ sao lưu tiếp theo."]
},{heading:"8. Quyền của bạn",bullets:["Xem và chỉnh sửa thông tin hồ sơ, cài đặt ngay trong ứng dụng.","Yêu cầu bản sao dữ liệu của bạn, yêu cầu sửa hoặc xoá dữ liệu qua email "+t+".","Ngừng sử dụng dịch vụ và thu hồi quyền Đăng nhập bằng Google bất cứ lúc nào."]
},{heading:"9. Trẻ em",paragraphs:["Langoo không dành cho trẻ em dưới 13 tuổi và không cố ý thu thập dữ liệu của trẻ dưới 13 tuổi. Nếu bạn cho rằng chúng tôi đang lưu dữ liệu của một trẻ em, hãy liên hệ để chúng tôi xoá."]
},{heading:"10. Thay đổi chính sách",paragraphs:["Khi chính sách thay đổi, chúng tôi cập nhật trang này và ngày hiệu lực ở đầu trang. Với thay đổi quan trọng, chúng tôi sẽ thông báo trong ứng dụng."]
},{heading:"11. Liên hệ",paragraphs:[`${a.vi} — email: ${t}`]}]
```

## Điều khoản tiếng Việt

```text
w={vi:{title:"Điều khoản sử dụng",intro:`Các điều khoản này áp dụng khi bạn sử dụng Langoo tại https://langoo.org và ứng dụng web cài đặt (PWA), do ${a.vi} vận hành. Khi tạo tài khoản hoặc sử dụng dịch vụ, bạn đồng ý với các điều khoản này và Chính sách quyền riêng tư.`,sections:[{heading:"1. Dịch vụ",paragraphs:["Langoo cung cấp công cụ tra từ Anh–Việt và Nhật–Việt, dịch văn bản, đọc PDF kèm tra từ, sổ tay từ vựng, ôn tập lặp lại ngắt quãng, quiz và Trợ lý AI. Tra từ, dịch và đọc PDF dùng được không cần tài khoản; các tính năng học tập cần đăng nhập. Dịch vụ hiện được cung cấp miễn phí và có thể thay đổi, tạm ngưng hoặc ngừng bất cứ lúc nào."]
},{heading:"2. Tài khoản",bullets:["Bạn cần từ 13 tuổi trở lên để tạo tài khoản.","Bạn chịu trách nhiệm giữ bí mật mật khẩu và mọi hoạt động diễn ra trong tài khoản của mình.","Thông tin bạn cung cấp khi đăng ký phải chính xác. Bạn có thể đăng nhập bằng email/mật khẩu hoặc bằng tài khoản Google."]
},{heading:"3. Sử dụng được phép",paragraphs:["Bạn không được:"],bullets:["Truy cập trái phép, dò quét lỗ hổng, can thiệp hoặc làm quá tải hệ thống.","Thu thập dữ liệu hàng loạt (scraping) từ từ điển hoặc API khi chưa được cho phép.","Dùng Trợ lý AI để tạo nội dung vi phạm pháp luật, xúc phạm, quấy rối hoặc gây hại.","Mạo danh người khác hoặc dùng dịch vụ cho mục đích gian lận."]
},{heading:"4. Nội dung của bạn",paragraphs:["Bạn giữ quyền đối với nội dung bạn tạo (sổ tay, ghi chú, tin nhắn, góp ý). Bạn cho phép chúng tôi lưu trữ và xử lý nội dung đó trong phạm vi cần thiết để cung cấp dịch vụ cho bạn, như mô tả trong Chính sách quyền riêng tư."]
},{heading:"5. Nội dung do AI tạo và dữ liệu từ điển",paragraphs:["Câu trả lời của Trợ lý AI, câu hỏi quiz và bản dịch máy có thể không chính xác. Hãy kiểm tra lại trước khi dựa vào chúng cho mục đích quan trọng.","Dữ liệu từ điển được tổng hợp từ các nguồn mở và được ghi công theo giấy phép của từng nguồn tại trang Nguồn dữ liệu (https://langoo.org/sources)."]
},{heading:"6. Sở hữu trí tuệ",paragraphs:["Giao diện, mã nguồn, logo và tên Langoo thuộc về "+a.vi+". Dữ liệu từ nguồn mở tuân theo giấy phép gốc của nguồn đó."]
},{heading:"7. Miễn trừ bảo đảm và giới hạn trách nhiệm",paragraphs:['Dịch vụ được cung cấp "nguyên trạng", không có bất kỳ bảo đảm nào về tính chính xác, liên tục hay phù hợp cho một mục đích cụ thể.',"Trong phạm vi pháp luật cho phép, chúng tôi không chịu trách nhiệm đối với thiệt hại gián tiếp, mất dữ liệu hoặc mất cơ hội phát sinh từ việc sử dụng hoặc không thể sử dụng dịch vụ."]
},{heading:"8. Chấm dứt",paragraphs:["Bạn có thể ngừng sử dụng và yêu cầu xoá tài khoản bất cứ lúc nào. Chúng tôi có thể tạm khoá hoặc chấm dứt tài khoản vi phạm các điều khoản này."]
},{heading:"9. Thay đổi điều khoản",paragraphs:["Chúng tôi có thể cập nhật các điều khoản này; ngày hiệu lực ở đầu trang sẽ thay đổi theo. Việc tiếp tục sử dụng dịch vụ sau khi cập nhật đồng nghĩa với việc bạn chấp nhận điều khoản mới."]
},{heading:"10. Luật áp dụng",paragraphs:["Các điều khoản này được điều chỉnh theo pháp luật Việt Nam."]
},{heading:"11. Liên hệ",paragraphs:[`${a.vi} — email: ${t}`]}]
```

## Đăng ký production

```javascript
import{r as N,j as s,l as b,L as S}from"./vendor-react-4trFa2Jg.js";import{i as F,j as _,o as A,s as i}from"./vendor-data--gSGo5mg.js";import{aK as C,E as P,u as I}from"./vendor-ui-CKLhz2aT.js";import{u as M,a as v,I as j,B as E,g as L,t}from"./index-B55iaWwM.js";import{F as R,a as n,b as l,c,d as m,e as d,g as k,A as B,f as q,G as z}from"./form-6yyNiMNh.js";import{P as f}from"./PasswordInput-D0M_OFx1.js";const D=A({display_name:i().trim().max(50,{error:()=>t("auth.displayNameMax")}).optional(),email:i().min(1,{error:()=>t("auth.emailRequired")}).email({error:()=>t("auth.emailInvalid")}),password:i().min(8,{error:()=>t("auth.passwordMin")}),confirm_password:i().min(1,{error:()=>t("auth.confirmRequired")})}).refine(o=>o.password===o.confirm_password,{path:["confirm_password"],error:()=>t("auth.confirmMismatch")});function O(){const{status:o,register:g}=M(),{t:e}=v(),[u,h]=N.useState(null),a=F({resolver:_(D),defaultValues:{display_name:"",email:"",password:"",confirm_password:""}}),p=a.formState.isSubmitting,w=async r=>{var x;h(null);try{await g({email:r.email,password:r.password,display_name:((x=r.display_name)==null?void 0:x.trim())||void 0}),I.success(e("auth.registerSuccess"))}catch(y){h(L(y))}};return o==="authenticated"?s.jsx(b,{to:"/onboarding",replace:!0}):s.jsxs("div",{className:"space-y-6",children:[s.jsxs("div",{className:"space-y-1.5",children:[s.jsx("h1",{className:"text-xl font-bold tracking-tight text-foreground",children:e("auth.registerTitle")}),s.jsx("p",{className:"text-sm text-muted-foreground",children:e("auth.registerSubtitle")})]}),s.jsx(R,{...a,children:s.jsxs("form",{onSubmit:a.handleSubmit(w),className:"space-y-4",children:[s.jsx(n,{control:a.control,name:"display_name",render:({field:r})=>s.jsxs(l,{children:[s.jsx(c,{children:e("auth.displayName")}),s.jsx(m,{children:s.jsx(j,{autoComplete:"nickname",placeholder:e("auth.displayNamePlaceholder"),...r})}),s.jsx(d,{})]})}),s.jsx(n,{control:a.control,name:"email",render:({field:r})=>s.jsxs(l,{children:[s.jsx(c,{children:e("auth.email")}),s.jsx(m,{children:s.jsx(j,{type:"email",autoComplete:"email",placeholder:e("auth.emailPlaceholder"),...r})}),s.jsx(d,{})]})}),s.jsx(n,{control:a.control,name:"password",render:({field:r})=>s.jsxs(l,{children:[s.jsx(c,{children:e("auth.password")}),s.jsx(m,{children:s.jsx(f,{autoComplete:"new-password",placeholder:e("auth.passwordHintPlaceholder"),...r})}),s.jsx(k,{children:e("auth.passwordHint")}),s.jsx(d,{})]})}),s.jsx(n,{control:a.control,name:"confirm_password",render:({field:r})=>s.jsxs(l,{children:[s.jsx(c,{children:e("auth.confirmPassword")}),s.jsx(m,{children:s.jsx(f,{autoComplete:"new-password",placeholder:e("auth.passwordConfirmPlaceholder"),...r})}),s.jsx(d,{})]})}),u&&s.jsxs(B,{variant:"destructive",children:[s.jsx(C,{className:"size-4"}),s.jsx(q,{children:u})]}),s.jsxs(E,{type:"submit",className:"w-full",disabled:p,children:[p&&s.jsx(P,{className:"size-4 animate-spin"}),e("auth.registerAction")]})]})}),s.jsx(z,{}),s.jsxs("p",{className:"text-center text-sm text-muted-foreground",children:[e("auth.hasAccount")," ",s.jsx(S,{to:"/login",className:"font-semibold text-primary underline-offset-4 hover:underline",children:e("auth.loginNow")})]})]})}export{O as default};

```

## Các đoạn bundle chính

### translate.googleapis.com — offset ký tự 215087

```text
late(e),engine:"on-device",detected:n==="auto"?s:null}}catch{return null}}async function Tm(e,n,a){try{const s=`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${n}&tl=${a}&dt=t&q=${encodeURIComponent(e)}`,r=await fetch(s);if(!r.ok)return console.warn("[translate] google: HTTP",r.status),null;const o=await r.json();if(!Array.isArray(o)||!Array.isArray(o[0]))return null;const l=o[0].map(i=>Array.isArray(i)?String(i[0]??""):
```

### api.mymemory.translated.net — offset ký tự 216550

```text
st(e)?"en":null}async function Lm(e,n,a){var r;const s=n==="auto"?Pm(e):n;if(!s||s===a)return null;try{const o=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(e)}&langpair=${s}|${a}`,l=await fetch(o);if(!l.ok)return console.warn("[translate] mymemory: HTTP",l.status),null;const u=(r=(await l.json()).responseData)==null?void 0:r.translatedText;return typeof u!="string"||!u||/no query specified|invalid|quota/i.test(u)?null:{text:
```

### /_vercel/insights/script.js — offset ký tự 327246

```text
e.scriptSrc):Js()?"https://va.vercel-scripts.com/v1/script.debug.js":e.basePath?Ft(`${e.basePath}/insights/script.js`):"/_vercel/insights/script.js"}function yp(e,n){var a;let s=e;if(n)try{s={...(a=JSON.parse(n))==null?void 0:a.analytics,...e}}catch{}pp(s.mode);const r={sdkn:gp+(s.framework?`/${s.framework}`:""),sdkv:fp};return s.disableAutoTrack&&(r.disableAutoTrack="1"),s.viewEndpoint&&(r.viewEndpoint=Ft(s.viewEndpoint)),s.eventEndpoint&&(r.
```

### /privacy — offset ký tự 139723

```text
e")}),t.jsx("nav",{className:"ml-auto flex flex-wrap items-center gap-x-4 gap-y-1","aria-label":"footer",children:[{to:"/privacy-policy",label:e("legal.privacy"),testId:"footer-privacy"},{to:"/terms-of-service",label:e("legal.terms"),testId:"footer-terms"},{to:"/sources",label:e("sources.title"),testId:"footer-sources"}].map(n=>t.jsx(pe,{to:n.to,className:"relative touch-hit text-xs text-muted-foreground underline-offset-4 t
```

### /privacy — offset ký tự 232103

```text
=>import("./index-C_xRiejk.js"),__vite__mapDeps([14,3,5,4]))),handle:{meta:kt("sources"),crumb:"sources.title"}},{path:"/privacy-policy",lazy:ge(()=>ae(()=>import("./index-DoXtiim2.js"),__vite__mapDeps([15,3,16,5,4]))),handle:{meta:kt("privacy"),crumb:"meta.privacy"}},{path:"/terms-of-service",lazy:ge(()=>ae(()=>import("./index-D2Yu2JOa.js"),__vite__mapDeps([17,3,16,5,4]))),handle:{meta:kt("terms"),crumb:"meta.terms"}}],Bi=[
```

### /terms — offset ký tự 139795

```text
4 gap-y-1","aria-label":"footer",children:[{to:"/privacy-policy",label:e("legal.privacy"),testId:"footer-privacy"},{to:"/terms-of-service",label:e("legal.terms"),testId:"footer-terms"},{to:"/sources",label:e("sources.title"),testId:"footer-sources"}].map(n=>t.jsx(pe,{to:n.to,className:"relative touch-hit text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline","data-testid":
```

### /terms — offset ký tự 232259

```text
import("./index-DoXtiim2.js"),__vite__mapDeps([15,3,16,5,4]))),handle:{meta:kt("privacy"),crumb:"meta.privacy"}},{path:"/terms-of-service",lazy:ge(()=>ae(()=>import("./index-D2Yu2JOa.js"),__vite__mapDeps([17,3,16,5,4]))),handle:{meta:kt("terms"),crumb:"meta.terms"}}],Bi=[{path:"/onboarding",lazy:ge(()=>ae(()=>import("./index-DnSKDSsS.js"),__vite__mapDeps([18,3,4,5,19])))}],Vi=[{path:"/collections",handle:{nav:{labelKey:"na
```

### Tệp PDF không rời — offset ký tự 36033

```text
trong trình duyệt, vẽ và tô màu ghi chú rồi lưu thẳng vào file.",point1:"Không khớp từ điển thì tự dịch cả cụm",point2:"Tệp PDF không rời khỏi máy bạn",try:"Thử ngay — bôi đen một từ trong câu này:"},flashcard:{tab:"Flashcard",title:"Ôn đúng lúc sắp quên",body:"Từ trong sổ tay tự xếp lịch ôn theo phương pháp lặp lại ngắt quãng. Lật thẻ và tự chấm mức độ nhớ của mình.",point1:"Bộ từ mẫu JLPT có sẵn để bắt đầu",point2:"Quiz trắc nghiệm
```
