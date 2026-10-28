---
name: langoo-workflow
description: >-
  Use this skill whenever planning, implementing, debugging, reviewing, or committing code in the Langoo project.
  Enforces Langoo's strict agent protocol, task coding conventions (M/DB/DOCS), progress tracking, and domain architecture rules.
---

# Langoo Workflow & Agent Protocol

This skill enforces the official development methodology and agent guidelines for the Langoo repository (defined in `AGENTS.md`, `PROMPT-BACKEND.md`, and `CONTEXT-DU-AN.md`).

---

## 1. Golden Rules (Non-Negotiable)

1. **Checkout & Branch Policy:**
   - Always work directly on `main` within the single checkout.
   - **NEVER** create new git worktrees (stipulated in `AGENTS.md` since 2026-10-26).
2. **Every Task Must Have a Code & Name:**
   - Backend milestones: `M10`, `M10.1`, `M11.1`, `M12`...
   - Database / data pipeline phases: `DB3-B0`, `DB4-D1`, `DB4-D2`...
   - Process / documentation tasks: `DOCS1`, `DOCS2`...
   - Never use ambiguous codes. Keep the exact code across plans, reviews, commits, and `PROGRESS.md`.
3. **Execution Rhythm (PROMPT-BACKEND §1.1):**
   - **Step 1:** Write a concise plan (target, files to touch, endpoints, tests, dependencies).
   - **Step 2:** Wait for user approval ("OK").
   - **Step 3:** Implement strictly within approved scope.
   - **Step 4:** Run tests and verify (`npm test`, lint, typecheck).
   - **Step 5:** Record changes in `PROGRESS.md` and appropriate `docs/` file, report according to standard format.
4. **Never Commit Secrets:**
   - Never commit `.env`, API keys, database connection strings, or bearer tokens.

---

## 2. Domain & Architectural Constraints

When coding any backend feature in Langoo, always respect the core domain invariants:

1. **NO `cards` table:**
   - Flashcards are a presentation/review mode of collections. Data lives in `app.collection_item` + `app.collection_item_face`. SRS schedule lives in `app.srs_state`.
2. **Cross-lingual linking is at Sense level:**
   - English and Japanese are linked through shared non-linguistic `concept` IDs (tied to CILI / WordNet). Never link words as raw strings or create flat `en_ja_pairs`.
3. **No string adding:**
   - Clients must send `sense_id` (when creating/saving words) and `face_id` + `direction` (when reviewing). The server must never guess or resolve by string lookup during review.
4. **Content Quality Gate:**
   - Only data with `status = 'curated'` can be presented to learners from concept mappings. Machine-generated glosses must carry uncurated flags and permit user reports (`app.gloss_report`).

---

## 3. Progress Tracking Template

Every change turn must log an entry in `PROGRESS.md` using the exact structure:

```markdown
### YYYY-MM-DD — <Mã> — <Tên thay đổi cụ thể>

- Thay đổi / lý do: <Mô tả tóm tắt lý do và việc đã làm>
- File / phạm vi: <Các file và module bị ảnh hưởng>
- Kiểm tra / kết quả: <Lệnh kiểm tra đã chạy, số test pass, lint pass>
- Gate còn thiếu / việc tiếp theo: <Những phần chưa test hoặc việc cần làm tiếp theo>
- Git / triển khai: <Commit hash, trạng thái push/deploy>
```
