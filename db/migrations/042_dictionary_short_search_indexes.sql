-- M4.2: one-character contains and one-letter prefix indexes.
-- Do not change core.bigrams: its existing indexes must remain valid.
CREATE FUNCTION core.search_characters(t text)
RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $function$
  SELECT coalesce(array_agg(DISTINCT substr(t, i, 1)), ARRAY[]::text[])
  FROM generate_series(1, length(t)) AS i
$function$;

COMMENT ON FUNCTION core.search_characters(text) IS
  'M4.2: distinct Unicode characters for one-character substring search; call with lower().';

CREATE INDEX lexeme_lemma_chars
  ON core.lexeme USING gin (core.search_characters(lower(lemma)));
CREATE INDEX lexeme_reading_chars
  ON core.lexeme USING gin (core.search_characters(lower(reading)));
CREATE INDEX lexeme_romanization_chars
  ON core.lexeme USING gin (core.search_characters(lower(romanization)));
CREATE INDEX lexeme_form_text_chars
  ON core.lexeme_form USING gin (core.search_characters(lower(form_text)));

CREATE INDEX lexeme_lemma_lower_prefix
  ON core.lexeme (lower(lemma) text_pattern_ops);
CREATE INDEX lexeme_reading_lower_prefix
  ON core.lexeme (lower(reading) text_pattern_ops);
CREATE INDEX lexeme_romanization_lower_prefix
  ON core.lexeme (lower(romanization) text_pattern_ops);
CREATE INDEX lexeme_form_text_lower_prefix
  ON core.lexeme_form (lower(form_text) text_pattern_ops);
