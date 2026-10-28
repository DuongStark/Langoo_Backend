---
name: prisma-db-inspector
description: >-
  Use this skill when inspecting database schemas, planning schema migrations, or working with Prisma 7 and PostgreSQL in Langoo.
  Enforces multi-schema navigation, migration immutability rules, and reference lookup in CSDL-THAM-CHIEU.md.
---

# Prisma & PostgreSQL Database Inspector

Langoo runs on **PostgreSQL 16+** with 5 schemas (`app`, `dict_en`, `dict_ja`, `dict_vi`, `dict_shared`), **92 tables + 4 views**, managed by **Prisma 7** (`@prisma/client`, `@prisma/adapter-pg`) and raw SQL migrations.

---

## 1. Schema Layout & Division of Responsibility

| Schema | Purpose | Key Tables |
| :--- | :--- | :--- |
| `app` | Core user data, SRS, collections, activity | `users`, `collection`, `collection_item`, `collection_item_face`, `srs_state`, `review_log`, `streak_day` |
| `dict_shared`| Interlingual concepts, senses, semantic links | `concept`, `sense`, `lexeme`, `semantic_relation` |
| `dict_en` | English dictionary | `en_words`, `en_definitions`, `en_examples` |
| `dict_ja` | Japanese dictionary, kanji, kana, stroke order | `ja_words`, `ja_kanji`, `ja_radicals`, `ja_readings`, `ja_examples` |
| `dict_vi` | Vietnamese glosses and translations | `vi_glosses`, `vi_synonyms` |

---

## 2. Fast Schema Lookup

Instead of running slow queries or reading entire massive files:
1. **Prisma Models:** Inspect `prisma/schema.prisma` for high-level relations and field mappings.
2. **Column/Type/FK/Index Details:** Search `CSDL-THAM-CHIEU.md` for specific table definitions (e.g., `grep -A 30 "### Bảng app.srs_state" CSDL-THAM-CHIEU.md`).
3. **Historical SQL Migrations:** Check `db/migrations/` for exact DDL statements.

---

## 3. Migration Rules (Strict)

1. **Sequential Numbering:**
   - Migrations in `db/migrations/NNN_tên.sql` run in strict alphabetical/numerical order.
   - Migrations `001`–`027` and `029`–`032` are already applied to production.
   - Number `028` is reserved for email verification (M2.3).
   - Any new migration MUST start at **`033_...`** or the next highest unused number.
2. **Immutability:**
   - **NEVER** edit or delete an existing migration file that has already been applied.
   - Any fix or schema change must be added as a new migration forward.
3. **Prisma Sync:**
   - Whenever a migration is added, update `prisma/schema.prisma` and run:
     ```bash
     npx prisma validate
     npx prisma format
     npm run prisma:generate
     ```
