import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const DATA_BUCKET = 'universalplastic-sedia';
const DATA_BUCKET_REGION = 'eu-central-1';
const DATA_BUCKET_PUBLIC_BASE = `https://${DATA_BUCKET}.s3.${DATA_BUCKET_REGION}.amazonaws.com`;

export type AnalysisUploadResult = {
  pdfUrl: string;
  jsonUrl: string;
  s3Prefix: string;
};

export async function uploadAnalysisResultToS3(opts: {
  requestId: string;
  /** Basin the archive is filed under, resolved from the read model by the caller. */
  ocean: string;
  pdfPath: string;
  responseJson: unknown;
}): Promise<AnalysisUploadResult> {
  const { ocean } = opts;
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const prefix = `public/${ocean}/universal_plastic/analise-${date}`;
  const client = new S3Client({ region: DATA_BUCKET_REGION });

  const pdfKey = `${prefix}/report.pdf`;
  const jsonKey = `${prefix}/result.json`;

  await client.send(new PutObjectCommand({
    Bucket: DATA_BUCKET,
    Key: pdfKey,
    Body: await fs.readFile(opts.pdfPath),
    ContentType: 'application/pdf',
  }));

  await client.send(new PutObjectCommand({
    Bucket: DATA_BUCKET,
    Key: jsonKey,
    Body: JSON.stringify(opts.responseJson, null, 2),
    ContentType: 'application/json',
  }));

  return {
    pdfUrl: `${DATA_BUCKET_PUBLIC_BASE}/${pdfKey}`,
    jsonUrl: `${DATA_BUCKET_PUBLIC_BASE}/${jsonKey}`,
    s3Prefix: `s3://${DATA_BUCKET}/${prefix}`,
  };
}

export type UploadResult = {
  bucket: string;
  prefix: string;
  webpUrlsByKey: Record<string, string>;
  pdfUrl: string;
};

function getS3Config(): { bucket: string; prefix: string; region?: string } | null {
  const bucket = process.env.S3_BUCKET ?? process.env.AWS_S3_BUCKET ?? 'ondas-dataspace-analyses';
  const prefix = (process.env.S3_PREFIX ?? 'plots').replace(/^\/+|\/+$/g, '');
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!bucket) return null;
  return { bucket, prefix, region: region || undefined };
}

async function toObjectUrl(client: S3Client, bucket: string, key: string): Promise<string> {
  const explicitPublicBase = process.env.S3_PUBLIC_BASE_URL?.replace(/\/+$/g, '');
  if (explicitPublicBase) {
    return `${explicitPublicBase}/${key}`;
  }

  // Default to presigned URLs (works for private buckets too).
  const expiresIn = Number(process.env.S3_PRESIGNED_EXPIRES_SECONDS ?? 60 * 60); // 1h
  return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600,
  });
}

export async function uploadPlotsToS3(opts: {
  requestId: string;
  webpPathsByKey: Record<string, string>;
  pdfPath: string;
}): Promise<UploadResult | null> {
  const cfg = getS3Config();
  if (!cfg) return null;

  // Credentials are picked up from environment (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, IAM role, etc.).
  const client = new S3Client({ region: cfg.region });

  const baseKeyPrefix = `${cfg.prefix}/${opts.requestId}`.replace(/\/+/g, '/');

  const webpUrlsByKey: Record<string, string> = {};
  for (const [plotKey, filePath] of Object.entries(opts.webpPathsByKey)) {
    const filename = path.basename(filePath);
    const key = `${baseKeyPrefix}/${filename}`;
    const body = await fs.readFile(filePath);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: 'image/webp',
      }),
    );
    webpUrlsByKey[plotKey] = await toObjectUrl(client, cfg.bucket, key);
  }

  {
    const filename = path.basename(opts.pdfPath);
    const key = `${baseKeyPrefix}/${filename}`;
    const body = await fs.readFile(opts.pdfPath);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/pdf',
      }),
    );
    return {
      bucket: cfg.bucket,
      prefix: cfg.prefix,
      webpUrlsByKey,
      pdfUrl: await toObjectUrl(client, cfg.bucket, key),
    };
  }
}

