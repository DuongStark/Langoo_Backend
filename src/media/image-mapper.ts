import { ImageCandidate, ImageContract } from './types/image.types';

const ALLOWED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
]);

const MAX_DIMENSION = 16384;
const MIN_DIMENSION = 1;

function parseDimension(val: unknown): number | null {
  if (typeof val === 'number') {
    if (!Number.isInteger(val) || val < MIN_DIMENSION || val > MAX_DIMENSION) {
      return null;
    }
    return val;
  }
  if (typeof val === 'string') {
    if (!/^\d{1,5}$/.test(val)) {
      return null;
    }
    const parsed = Number(val);
    if (
      !Number.isInteger(parsed) ||
      parsed < MIN_DIMENSION ||
      parsed > MAX_DIMENSION
    ) {
      return null;
    }
    return parsed;
  }
  return null;
}

function isValidObjectKey(key: string): boolean {
  if (typeof key !== 'string' || key.trim() === '') {
    return false;
  }
  for (let i = 0; i < key.length; i++) {
    const code = key.charCodeAt(i);
    if (code <= 31 || code === 127 || code === 92 || code === 32) {
      return false;
    }
  }
  // No leading slash or URL scheme
  if (key.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(key)) {
    return false;
  }
  if (/%(?:2e|2f|5c|25)/i.test(key)) return false;
  const segments = key.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      return false;
    }
  }
  return true;
}

export function mapImage(
  candidate: ImageCandidate | null,
  baseUrl: string,
): ImageContract | null {
  if (!candidate || !candidate.object_key || !candidate.mime) {
    return null;
  }

  const mime = candidate.mime.toLowerCase().trim();
  if (!ALLOWED_MIMES.has(mime)) {
    return null;
  }

  const rawKey = candidate.object_key.trim();
  if (!isValidObjectKey(rawKey)) {
    return null;
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const segments = rawKey.split('/').map((s) => encodeURIComponent(s));
  const url = `${cleanBase}/${segments.join('/')}`;

  let width: number | null = null;
  let height: number | null = null;

  if (
    candidate.metadata &&
    typeof candidate.metadata === 'object' &&
    !Array.isArray(candidate.metadata)
  ) {
    const meta = candidate.metadata as Record<string, unknown>;
    width = parseDimension(meta.width);
    height = parseDimension(meta.height);
  }

  return {
    url,
    mime,
    width,
    height,
  };
}
