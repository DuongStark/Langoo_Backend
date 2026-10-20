-- Autocomplete VI→EN/JA: prefix không phân biệt dấu (unaccent).
-- unaccent() mặc định là STABLE nên không dùng trực tiếp trong expression index;
-- wrapper IMMUTABLE dưới đây là pattern chuẩn của Postgres.
-- Guard như 033: môi trường dev nhúng thiếu contrib → chỉ NOTICE, bỏ qua.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    RAISE NOTICE '043: bỏ qua f_unaccent/index (thiếu extension unaccent)';
    RETURN;
  END IF;

  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION public.f_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
  $ddl$;

  EXECUTE 'CREATE INDEX IF NOT EXISTS translation_assertion_vi_prefix
             ON core.translation_assertion (public.f_unaccent(lower(target_text)) text_pattern_ops)
             WHERE target_language_id = 3';
END $$;
