import type { RankedSense } from './learner-priority';

export interface PilotWord {
  lemma: string;
  senses: RankedSense[];
  recommended: RankedSense;
  previous: RankedSense;
  changed: boolean;
  viNote?: string;
  reviewNote?: string;
  learnerOverride?: { automaticSenseId: string; reason: string };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function label(sense: RankedSense): string {
  return `${sense.source} · ${sense.pos} · sense ${sense.senseId}`;
}

export function renderPilot(words: PilotWord[], summary: unknown): string {
  const cards = words
    .map((word, index) => {
      const current = word.recommended;
      const variants = new Map<string, RankedSense[]>();
      for (const sense of word.senses) {
        const key = `${sense.source} / ${sense.pos} / lexeme ${sense.lexemeId}`;
        variants.set(key, [...(variants.get(key) ?? []), sense]);
      }
      const allSenses = [...variants]
        .map(
          ([key, senses]) => `<details>
      <summary>${escapeHtml(key)} — ${senses.length} nghĩa</summary>
      <ol>${senses
        .map(
          (
            sense,
          ) => `<li><p>${escapeHtml(sense.definition || '(Nguồn chưa có định nghĩa)')}</p>
        <small>${escapeHtml(label(sense))} · ${escapeHtml(sense.priorityReason)}${sense.tags.length ? ' · tags: ' + escapeHtml(sense.tags.join(', ')) : ''}${sense.topics.length ? ' · topics: ' + escapeHtml(sense.topics.join(', ')) : ''}</small>
        ${sense.glossEnContext.length > 1 ? `<details><summary>Context nguồn</summary><ul>${sense.glossEnContext.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul></details>` : ''}
      </li>`,
        )
        .join('')}</ol></details>`,
        )
        .join('');
      return `<article data-word="${escapeHtml(word.lemma)}" data-changed="${word.changed}" data-counted="${(current.wordnet?.count ?? 0) > 0}" data-review="${Boolean(word.reviewNote)}">
      <header><h2><span class="number">${index + 1}.</span> ${escapeHtml(word.lemma)}</h2>
      <span class="badge">${escapeHtml(current.pos)}</span>${word.changed ? '<span class="badge changed">Đổi nghĩa đầu</span>' : ''}</header>
      <p class="meaning">${escapeHtml(current.definition)}</p>
      ${current.glossVi ? `<p class="vi">VI có sẵn: ${escapeHtml(current.glossVi)}${current.glossViMachine ? ' · máy dịch' : ''}${current.glossViReviewed ? ' · có review' : ' · chưa review'}</p>` : '<p class="muted">Sense được chọn chưa có gloss VI trong DB.</p>'}
      ${word.viNote ? `<p class="vi">Diễn giải VI để đọc báo cáo: ${escapeHtml(word.viNote)}</p><small>Do agent biên tập trong phiên, không phải gloss DB/đã được người duyệt.</small>` : ''}
      <p><small>${escapeHtml(label(current))} · ${word.senses.length} sense giữ nguyên từ các nguồn</small></p>
      ${word.learnerOverride ? `<p class="review">Đề xuất ưu tiên cho người học của agent: ${escapeHtml(word.learnerOverride.reason)}. Baseline tự động: sense ${escapeHtml(word.learnerOverride.automaticSenseId)}. Chưa áp vào DB.</p>` : ''}
      <p class="reason">Bằng chứng nguồn của sense: ${escapeHtml(current.priorityReason)}</p>
      ${word.reviewNote ? `<p class="review">Ghi nhận kiểm mẫu: ${escapeHtml(word.reviewNote)}</p>` : ''}
      <details><summary>So với nghĩa đứng đầu theo sense_no của cùng lexeme</summary><p>${escapeHtml(word.previous.definition)}</p><small>${escapeHtml(label(word.previous))} · sense_no ${word.previous.senseNo}. Đây là baseline local, không mô phỏng toàn bộ UI live.</small></details>
      <details class="others"><summary>Xem tất cả ${word.senses.length} nghĩa và các nguồn</summary>${allSenses}</details>
    </article>`;
    })
    .join('\n');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>M4.5 — Pilot 100 từ EN</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#14243d;font:16px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:auto;padding:28px 20px}h1{font-size:28px;margin:0 0 12px}h2{font-size:25px;margin:0}.intro{color:#46566f}.notice{background:#fff2d7;padding:16px;border-radius:12px}.controls{position:sticky;top:0;z-index:1;display:flex;gap:12px;flex-wrap:wrap;padding:14px 0;background:#f5f7fb}input,select{font:inherit;padding:9px 12px;border:1px solid #bdcce0;border-radius:9px}input{flex:1;min-width:220px}article{background:white;border:1px solid #d7e0ed;border-radius:14px;padding:22px;margin:16px 0;scroll-margin-top:90px}header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.number{font-size:16px;color:#62738c}.badge{font-size:12px;background:#eaf0fa;border-radius:6px;padding:3px 8px}.changed{background:#e2f5e7;color:#165c31}.meaning{font-size:19px;font-weight:600}.vi{color:#214b91}.muted,small{color:#65758c}.reason,.review{background:#f0f5fc;padding:10px;border-radius:8px}details{border-top:1px solid #e6ecf4;padding-top:12px;margin-top:12px}summary{cursor:pointer;color:#284e85}li{padding:3px 0}li p{margin:5px 0}pre{white-space:pre-wrap;font-size:13px}.hidden{display:none}footer{color:#65758c;margin-top:30px}
  </style></head><body><main><h1>M4.5 — Pilot 100 từ EN</h1>
  <p class="intro">Một nghĩa gợi ý cho mỗi headword; các nguồn/POS/sense khác còn đầy đủ bên dưới. Dùng rule + WordNet; đề xuất ưu tiên biên tập nếu có được ghi riêng. Không gọi API AI, không chỉnh DB hay app live.</p>
  <p class="notice">Số đếm WordNet là tín hiệu từ nguồn cũ, chưa xác minh corpus của snapshot này; không phải phần trăm sử dụng hiện đại. Không có count ≠ nghĩa hiếm. Bản này để xem chất lượng, chưa nghiệm thu ≥90/100.</p>
  <details><summary>Thông tin lần chạy</summary><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></details>
  <div class="controls"><input id="query" type="search" placeholder="Tìm trong 100 từ: cat, dog, run…" aria-label="Tìm từ"><select id="filter" aria-label="Lọc kết quả"><option value="all">Tất cả</option><option value="review">Cần xem lại ưu tiên</option><option value="changed">Đổi nghĩa đầu</option><option value="counted">Có số đếm nguồn</option><option value="fallback">Không có số đếm nguồn</option></select><span id="visible"></span></div>
  ${cards}<footer>Artifact offline — mở trực tiếp, không gửi dữ liệu ra mạng. VI chú thích nếu có chỉ phục vụ đọc báo cáo. Chọn sense để tích hợp sau này phải dùng chính ID và scope của card.</footer></main>
  <script>const q=document.getElementById('query'),f=document.getElementById('filter'),cards=[...document.querySelectorAll('article')];function update(){let n=0;for(const card of cards){const match=card.dataset.word.includes(q.value.trim().toLowerCase())&&(f.value==='all'||f.value==='review'&&card.dataset.review==='true'||f.value==='changed'&&card.dataset.changed==='true'||f.value==='counted'&&card.dataset.counted==='true'||f.value==='fallback'&&card.dataset.counted==='false');card.classList.toggle('hidden',!match);if(match)n++;}document.getElementById('visible').textContent=n+'/100 từ';}q.addEventListener('input',update);f.addEventListener('change',update);update();</script></body></html>`;
}
