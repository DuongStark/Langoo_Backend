/** A lemma alias is accepted only within one request with unique lemma and explicit filename receipt. */
export function normalizeMediaIdentity(rows, plans) {
  const text = rows.map((r) => r.text || '').join('\n');
  return rows
    .flatMap((r) => r.media || [])
    .map((media) => {
      const matches = plans.filter(
        (p) =>
          media.label === `Open generated image ${p.lemma}` ||
          media.label === `Open generated image ${p.lemma}.png`,
      );
      if (matches.length !== 1) return media;
      const plan = matches[0];
      if (
        !new RegExp(
          `(?:^|[^a-zA-Z0-9-])${plan.file.replace(/\./g, '\\.')}(?=$|[^a-zA-Z0-9.-])`,
        ).test(text)
      )
        return media;
      return {
        ...media,
        label: `Open generated image ${plan.file}`,
        original_label: media.label,
      };
    });
}
export function coveredByLaterRequests(record, later, states) {
  const covered = new Set(later.flatMap((r) => r.target_ids));
  return record.target_ids.every(
    (id) => states[id]?.status === 'complete' || covered.has(id),
  );
}
