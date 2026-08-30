import { AwsClient } from 'aws4fetch';

export interface PresignedPost {
  url: string;
  fields?: Record<string, string>;
  expiresAt: number;
}

export interface R2Env {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  R2_ENDPOINT?: string;
}

const DEFAULT_EXPIRES = 900; // 15m

export const createPresignedPost = async (
  env: R2Env,
  r2Key: string,
  mimeType: string,
  expiresSeconds = DEFAULT_EXPIRES,
): Promise<PresignedPost> => {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) {
    throw new Error('Missing R2 env: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET');
  }

  const endpoint = env.R2_ENDPOINT ?? `https://${env.R2_BUCKET}.r2.cloudflarestorage.com`;
  const urlBase = `${endpoint.replace(/\/$/, '')}/${r2Key}?X-Amz-Expires=${expiresSeconds}`;

  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    region: 'auto',
    service: 's3',
  });

  const signed = await client.sign(
    new Request(urlBase, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
    }),
    {
      aws: { signQuery: true, allHeaders: true },
    },
  );

  const expiresAt = Date.now() + expiresSeconds * 1000;

  return {
    url: signed.url,
    expiresAt,
  };
};
