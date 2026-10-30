/** M14.1 operational pilot. Credentials remain outside repo; --apply is explicit. */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadR2Config, loadImages } from './images.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const profileArgs = args.filter((x) => x.startsWith('--profile='));
if (profileArgs.length > 1) throw Error('PROFILE_ARGUMENT_INVALID');
const profile = profileArgs[0]?.slice('--profile='.length) || 'phone-c';
const positionals = args.filter(
  (x) => x !== '--apply' && !x.startsWith('--profile='),
);
if (positionals.length !== 2 || positionals.some((x) => x.startsWith('--'))) {
  console.error(
    'Usage: node scripts/media/r2-upload.mjs MANIFEST RECEIPT [--profile=phone-c|pilot1|pilot2] [--apply]',
  );
  process.exit(2);
}
const [manifest, output] = positionals.map((x) => resolve(x));
const config = loadR2Config(resolve(homedir(), '.config/langoo/r2.env'));
const images = loadImages(manifest, { profile });
mkdirSync(dirname(output), { recursive: true });
const lock = output + '.lock';
let lockFd, client;
const receipt = {
  task: 'M14.1',
  bucket: config.bucket,
  public_base: config.publicBase,
  created_at: new Date().toISOString(),
  mode: apply ? 'apply' : 'dry-run',
  assets: [],
};
const save = () => writeFileSync(output, JSON.stringify(receipt, null, 2));
try {
  lockFd = openSync(lock, 'wx', 0o600);
  if (apply) {
    const requireSdk = createRequire(
      resolve(
        process.env.M141_SDK_ROOT || '/tmp/langoo-m141-r2-probe',
        'package.json',
      ),
    );
    const sdk = requireSdk('@aws-sdk/client-s3');
    client = new sdk.S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 1,
    });
    for (const image of images) {
      const { data, path, ...metadata } = image;
      const row = {
        ...metadata,
        public_url: `${config.publicBase}/${image.key}`,
        state: 'checking',
        uploaded: false,
      };
      receipt.assets.push(row);
      save();
      let exists = true;
      try {
        await client.send(
          new sdk.HeadObjectCommand({ Bucket: config.bucket, Key: image.key }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 404) exists = false;
        else throw error;
      }
      if (!exists) {
        row.state = 'put_intent';
        save();
        try {
          await client.send(
            new sdk.PutObjectCommand({
              Bucket: config.bucket,
              Key: image.key,
              Body: data,
              ContentType: image.mime,
              CacheControl: 'public,max-age=31536000,immutable',
              Metadata: {
                sha256: image.sha256,
                prompt_version: image.prompt_version,
              },
              IfNoneMatch: '*',
            }),
            { abortSignal: AbortSignal.timeout(30000) },
          );
          row.uploaded = true;
        } catch (error) {
          if (error.$metadata?.httpStatusCode !== 412) throw error;
        }
      }
      row.state = 'put_or_existing';
      save();
      const received = await client.send(
        new sdk.GetObjectCommand({ Bucket: config.bucket, Key: image.key }),
        { abortSignal: AbortSignal.timeout(30000) },
      );
      const bytes = await received.Body.transformToByteArray();
      if (
        received.ContentType !== image.mime ||
        createHash('sha256').update(bytes).digest('hex') !== image.sha256
      )
        throw Error('S3_READBACK_MISMATCH');
      row.s3_verified = true;
      row.state = 's3_verified';
      save();
      const response = await fetch(row.public_url, {
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw Error('PUBLIC_HTTP_' + response.status);
      const publicBytes = await response.arrayBuffer();
      if (
        !response.headers.get('content-type')?.startsWith(image.mime) ||
        createHash('sha256').update(Buffer.from(publicBytes)).digest('hex') !==
          image.sha256
      )
        throw Error('PUBLIC_READBACK_MISMATCH');
      row.public_verified = true;
      row.verified_at = new Date().toISOString();
      row.state = 'verified';
      save();
      console.log(
        JSON.stringify({
          file: image.file,
          uploaded: row.uploaded,
          s3_verified: true,
          public_verified: true,
          bytes: image.bytes,
        }),
      );
    }
  } else {
    receipt.assets = images.map(({ data, path, ...image }) => ({
      ...image,
      public_url: `${config.publicBase}/${image.key}`,
      state: 'dry_run',
    }));
    save();
  }
  receipt.finished_at = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      mode: receipt.mode,
      count: receipt.assets.length,
      uploaded: receipt.assets.filter((x) => x.uploaded).length,
    }),
  );
} catch (error) {
  const code = /^[A-Z0-9_]+$/.test(error.message || '')
    ? error.message
    : /^[A-Za-z0-9]+$/.test(error.name || '')
      ? error.name
      : 'RedactedError';
  receipt.error = {
    code,
    http_status: error.$metadata?.httpStatusCode || null,
  };
  if (lockFd !== undefined) save();
  console.error(JSON.stringify(receipt.error));
  process.exitCode = 1;
} finally {
  client?.destroy();
  if (lockFd !== undefined) {
    closeSync(lockFd);
    unlinkSync(lock);
  }
}
