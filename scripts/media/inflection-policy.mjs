/** M14.2 conservative sense-level routing; suffix alone never establishes meaning. */
export function imageAction(item) {
  const definition = item.definition.trim();
  const grammar =
    /^(?:simple past(?: and past participle)?|past participle|present participle(?: and gerund)?|gerund|plural|third-person singular(?: simple present)?) of\s+([a-z][a-z -]*?)[.!]?$/i.exec(
      definition,
    );
  if (grammar) {
    const root = grammar[1].toLowerCase();
    if (
      ['be', 'have', 'become', 'seem', 'exist', 'matter', 'belong'].includes(
        root,
      )
    )
      return { group: 4, action: 'skip', root };
    return { group: 3, action: 'inherit', root };
  }
  if (/\b(?:philosophical|grammatical|propositional logic)\b/i.test(definition))
    return { group: 4, action: 'skip', root: null };
  if (item.pos === 'adjective')
    return { group: 1, action: 'generate', root: null };
  if (item.pos === 'noun') return { group: 2, action: 'generate', root: null };
  return { group: null, action: 'generate', root: null };
}

export function partitionImageActions(items) {
  const generate = [],
    deferred = {};
  for (const item of items) {
    const policy = imageAction(item);
    if (policy.action === 'generate') generate.push(item);
    else
      deferred[item.sense_id] = {
        lemma: item.lemma,
        ...policy,
        reason:
          policy.action === 'inherit'
            ? 'ROOT_SENSE_RESOLUTION_REQUIRED'
            : 'POLICY_NO_IMAGE',
      };
  }
  return { generate, deferred };
}
