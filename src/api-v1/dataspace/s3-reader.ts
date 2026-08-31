import { createHash } from 'node:crypto';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { DATA_BUCKET, DATA_BUCKET_REGION, publicUrlForKey } from './dataspace.constants';
import { REFERENCE_KEYS } from './reference-datasets';

/**
 * Reads the data space bucket.
 *
 * Objects are fetched over public HTTPS — that is how the API has always read
 * them and it needs no credentials. Listing needs `s3:ListBucket`, which the
 * runtime may not have; `listKeys` says so explicitly instead of failing opaquely,
 * and the sync falls back to SEED_KEYS.
 */

export interface FetchedObject {
  key: string;
  url: string;
  json: unknown;
  etag: string | null;
  sizeBytes: number | null;
  lastModified: Date | null;
  checksum: string;
}

export interface ObjectHead {
  key: string;
  etag: string | null;
  sizeBytes: number | null;
  lastModified: Date | null;
}

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object not found: ${key}`);
    this.name = 'ObjectNotFoundError';
  }
}

export class ListUnavailableError extends Error {
  constructor(reason: string) {
    super(`S3 listing unavailable: ${reason}`);
    this.name = 'ListUnavailableError';
  }
}

function cleanEtag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.replace(/^W\//, '').replace(/"/g, '').trim() || null;
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  const res = await fetch(publicUrlForKey(key), { method: 'HEAD' });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`HEAD ${res.status} for ${key}`);
  const len = res.headers.get('content-length');
  const modified = res.headers.get('last-modified');
  return {
    key,
    etag: cleanEtag(res.headers.get('etag')),
    sizeBytes: len ? Number(len) : null,
    lastModified: modified ? new Date(modified) : null,
  };
}

export async function getObject(key: string): Promise<FetchedObject> {
  const url = publicUrlForKey(key);
  const res = await fetch(url);
  if (res.status === 404 || res.status === 403) throw new ObjectNotFoundError(key);
  if (!res.ok) throw new Error(`GET ${res.status} for ${key}`);
  const body = await res.text();
  const len = res.headers.get('content-length');
  const modified = res.headers.get('last-modified');

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (e) {
    throw new Error(`invalid JSON in ${key}: ${(e as Error).message}`);
  }

  return {
    key,
    url,
    json,
    etag: cleanEtag(res.headers.get('etag')),
    sizeBytes: len ? Number(len) : Buffer.byteLength(body),
    lastModified: modified ? new Date(modified) : null,
    checksum: createHash('sha256').update(body).digest('hex'),
  };
}

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) client = new S3Client({ region: DATA_BUCKET_REGION });
  return client;
}

/** Lists every `.json` key under a prefix. Throws ListUnavailableError without permission. */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  try {
    do {
      const res = await s3().send(
        new ListObjectsV2Command({
          Bucket: DATA_BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (obj.Key?.endsWith('.json')) keys.push(obj.Key);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
  } catch (e) {
    throw new ListUnavailableError((e as Error).name === 'AccessDenied' ? 'AccessDenied' : (e as Error).message);
  }
  return keys;
}

/**
 * The inventory from docs/dataset-mapping.md. Used when the runtime cannot list
 * the bucket, so a backfill still works without `s3:ListBucket`.
 */
export const SEED_KEYS: string[] = [
  'public/mediterraneo/innoceana/recogidas_playas_barcelona.json',
  'public/mediterraneo/universal_plastic/recogidas_playas_badalona.json',
  'public/mediterraneo/universal_plastic/recogidas_playas_blanes.json',
  'public/mediterraneo/port_badalona/boya_biomasa_badalona.json',
  'public/mediterraneo/port_badalona/boya_microplasticos_badalona.json',
  'public/mediterraneo/universal_plastic/environmental_badalona.json',
  'public/mediterraneo/universal_plastic/atmosfera_badalona.json',
  'public/mediterraneo/universal_plastic/atmosfera_barcelona.json',
  'public/mediterraneo/universal_plastic/atmosfera_blanes.json',
  'public/mediterraneo/universal_plastic/oceanografia_badalona.json',
  'public/mediterraneo/universal_plastic/oceanografia_barcelona.json',
  'public/mediterraneo/universal_plastic/oceanografia_blanes.json',
  'public/atlantico/innoceana/recogidas_playa_tenerife.json',
  'public/atlantico/universal_plastic/boya_biomasa_cadiz.json',
  'public/atlantico/universal_plastic/environmental_cadiz.json',
  'public/atlantico/universal_plastic/atmosfera_tenerife.json',
  'public/atlantico/universal_plastic/oceanografia_tenerife.json',
  'public/catambrico/gijon_surf_hostel/recogidas_playas_gijon.json',
  'public/catambrico/universal_plastic/boya_biomasa_gijon.json',
  'public/catambrico/universal_plastic/environmental_gijon.json',
  'public/catambrico/universal_plastic/atmosfera_gijon.json',
  'public/catambrico/universal_plastic/oceanografia_gijon.json',
  // Calibration series the analytics engine falls back to (reference-datasets.ts).
  ...REFERENCE_KEYS,
];

export interface KeyListing {
  keys: string[];
  source: 'bucket' | 'seed';
  warning: string | null;
}

/** Lists the bucket, falling back to the bundled inventory. */
export async function listKeysWithFallback(prefix: string): Promise<KeyListing> {
  try {
    const keys = await listKeys(prefix);
    return { keys, source: 'bucket', warning: null };
  } catch (e) {
    if (!(e instanceof ListUnavailableError)) throw e;
    const keys = SEED_KEYS.filter((k) => k.startsWith(prefix));
    return {
      keys,
      source: 'seed',
      warning: `${e.message}; fell back to the bundled inventory (${keys.length} keys). Files added to the bucket since are not visible to the scan.`,
    };
  }
}
