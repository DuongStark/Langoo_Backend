/** M14.2 generic lexical meaning retrieval; never writes dictionary mappings. */
export function retrievalTokens(definition) {
  const stop = new Set([
    'the',
    'and',
    'for',
    'that',
    'which',
    'with',
    'from',
    'into',
    'this',
    'those',
    'these',
    'being',
    'having',
    'usually',
    'someone',
    'something',
    'person',
    'thing',
    'when',
    'where',
    'used',
    'such',
    'especially',
  ]);
  return [...new Set(definition.toLowerCase().match(/[a-z]{3,}/g) || [])]
    .filter((x) => !stop.has(x))
    .slice(0, 16);
}
export async function extraCandidates(client, item) {
  const lexical = (
    await client.query(
      `SELECT DISTINCT ON(candidate.concept_id) candidate.* FROM unnest($1::text[]) token
    CROSS JOIN LATERAL(SELECT DISTINCT ON(c.id) c.id::text concept_id,s.id::text anchor_sense_id,s.definition,c.gloss_en,c.status,l.pos
      FROM core.lexeme l JOIN core.sense s ON s.lexeme_id=l.id JOIN core.sense_concept sc ON sc.sense_id=s.id JOIN core.concept c ON c.id=sc.concept_id
      WHERE l.lemma=token AND l.language_id=$2 AND l.pos=$3 AND sc.relation='exact' AND sc.verified AND sc.confidence>=0.7 AND c.status IN('draft','curated')
      ORDER BY c.id,s.id LIMIT 2)candidate ORDER BY candidate.concept_id`,
      [retrievalTokens(item.definition), item.language_id, item.pos],
    )
  ).rows;

  const fulltext = (
    await client.query(
      `WITH query AS(SELECT replace(plainto_tsquery('english',$1)::text,' & ',' | ')::tsquery q), ranked AS(
 SELECT c.id,ts_rank_cd(to_tsvector('english',c.gloss_en),query.q,32) score FROM core.concept c CROSS JOIN query
 WHERE c.pos=$2 AND c.status IN('draft','curated') AND to_tsvector('english',c.gloss_en)@@query.q
 ORDER BY score DESC,c.id LIMIT 12)
 SELECT c.id::text concept_id,a.anchor_sense_id,a.definition,c.gloss_en,c.status,a.pos FROM ranked r JOIN core.concept c ON c.id=r.id
 JOIN LATERAL(SELECT s.id::text anchor_sense_id,s.definition,l.pos FROM core.sense_concept sc JOIN core.sense s ON s.id=sc.sense_id JOIN core.lexeme l ON l.id=s.lexeme_id
 WHERE sc.concept_id=c.id AND sc.relation='exact' AND sc.verified AND sc.confidence>=0.7 AND l.language_id=$3 AND l.pos=$2 ORDER BY s.id LIMIT 1)a ON true
 ORDER BY r.score DESC,c.id`,
      [item.definition, item.pos, item.language_id],
    )
  ).rows;
  return [
    ...lexical,
    ...fulltext.filter(
      (c) => !lexical.some((x) => x.concept_id === c.concept_id),
    ),
  ];
}
