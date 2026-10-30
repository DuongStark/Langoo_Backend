import { readFileSync, statSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const projectRequire = createRequire(
  process.env.M141_APP_ROOT
    ? resolve(process.env.M141_APP_ROOT, 'package.json')
    : new URL('../../package.json', import.meta.url),
);

export function loadR2Config(path) {
  const { parse } = projectRequire('dotenv');
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
    throw Error('CONFIG_NOT_PRIVATE');
  if (stat.size > 16384) throw Error('CONFIG_TOO_LARGE');
  const env = parse(readFileSync(path));
  for (const key of [
    'R2_ACCOUNT_ID',
    'R2_BUCKET',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_PUBLIC_BASE_URL',
  ])
    if (!env[key]?.trim()) throw Error('CONFIG_MISSING_' + key);
  if (!/^[0-9a-f]{32}$/i.test(env.R2_ACCOUNT_ID))
    throw Error('ACCOUNT_INVALID');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET))
    throw Error('BUCKET_INVALID');
  let url;
  try {
    url = new URL(env.R2_PUBLIC_BASE_URL);
  } catch {
    throw Error('PUBLIC_URL_INVALID');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.port
  )
    throw Error('PUBLIC_URL_INVALID');
  return {
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBase: url.href.replace(/\/$/, ''),
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

export const IMAGE_PROFILES = Object.freeze({
  auto: { version: 'muse-ordinary-auto-v1', scope: 'single_image_brief' },
  'phone-c': { version: 'muse-phone-c-v1', scope: 'single_image_brief' },
  pilot1: { version: 'muse-illustration-pilot-v1', scope: 'batch_brief' },
  pilot2: { version: 'muse-mixed-pilot-v1', scope: 'batch_brief' },
});
export function loadImages(manifestPath, { profile = 'phone-c' } = {}) {
  if (!Object.hasOwn(IMAGE_PROFILES, profile)) throw Error('PROFILE_INVALID');
  const { version, scope } = IMAGE_PROFILES[profile];
  const batchPrompt =
    scope === 'batch_brief'
      ? readFileSync(join(dirname(manifestPath), 'prompt.txt'), 'utf8')
      : null;
  if (
    batchPrompt !== null &&
    (!batchPrompt.trim() || batchPrompt.length > 32768)
  )
    throw Error('BATCH_PROMPT_INVALID');
  const rows = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(rows) || rows.length > 100)
    throw Error('MANIFEST_INVALID');
  const selected =
    profile === 'phone-c' ? rows.filter((row) => row.variant === 'C') : rows;
  if (
    !selected.length ||
    new Set(selected.map((row) => row.sense_id)).size !== selected.length
  )
    throw Error('MANIFEST_DUPLICATE_OR_EMPTY');
  return selected.map((row) => {
    if (
      typeof row.file !== 'string' ||
      row.file !== basename(row.file) ||
      !(
        profile === 'phone-c'
          ? /^[a-z][a-z0-9-]*-C\.png$/
          : /^[a-z][a-z0-9-]*\.png$/
      ).test(row.file)
    )
      throw Error('IMAGE_PATH_INVALID');
    const prompt = batchPrompt ?? row.image_prompt;
    if (
      !/^[1-9][0-9]*$/.test(row.sense_id) ||
      typeof prompt !== 'string' ||
      !prompt.trim() ||
      typeof row.definition !== 'string' ||
      !row.definition.trim()
    )
      throw Error('IMAGE_SOURCE_INVALID');
    const path = join(dirname(manifestPath), row.file),
      data = readFileSync(path);
    const hash = createHash('sha256').update(data).digest('hex');
    if (hash !== row.sha256) throw Error('IMAGE_HASH_MISMATCH');
    if (
      data.length < 24 ||
      data.length > 10 * 1024 * 1024 ||
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw Error('IMAGE_FORMAT_INVALID');
    const width = data.readUInt32BE(16),
      height = data.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096)
      throw Error('IMAGE_SIZE_INVALID');
    return {
      file: row.file,
      path,
      data,
      sha256: hash,
      bytes: data.length,
      width,
      height,
      sense_id: row.sense_id,
      lemma: row.lemma,
      prompt,
      prompt_scope: scope,
      source_definition: row.definition,
      source_definition_sha256: createHash('sha256')
        .update(row.definition)
        .digest('hex'),
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      prompt_version: version,
      mime: 'image/png',
      key: `illustrations/${version}/${hash}.png`,
    };
  });
}

export function mappingDecision(links) {
  if (!links.length) return { state: 'missing_mapping' };
  const eligible = links.filter(
    (x) =>
      x.verified === true &&
      x.relation === 'exact' &&
      Number(x.confidence) >= 0.7,
  );
  if (!eligible.length) return { state: 'unverified_mapping' };
  if (eligible.length !== 1) return { state: 'ambiguous_mapping' };
  return {
    state: eligible[0].status === 'curated' ? 'approved' : 'pending',
    concept_id: String(eligible[0].concept_id),
  };
}
