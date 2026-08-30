// Forkers: set VITE_UPLOAD_DEWEK_URL to your worker URL or use Settings in UI (localStorage)
const getBaseUrl = (): string => {
  const ls = typeof window !== 'undefined' ? window.localStorage.getItem('uploadDewekBaseUrl') : null;
  if (ls !== null && ls !== '') return ls.replace(/\/$/, '');
  // @ts-expect-error Vite env
  const envUrl = import.meta.env.VITE_UPLOAD_DEWEK_URL as string | undefined;
  return (envUrl ?? 'http://localhost:8787').replace(/\/$/, '');
};

const getApiKey = (): string => {
  const ls = typeof window !== 'undefined' ? window.localStorage.getItem('uploadDewekApiKey') : null;
  if (ls !== null && ls !== '') return ls;
  // @ts-expect-error Vite env
  const envKey = import.meta.env.VITE_UPLOAD_DEWEK_API_KEY as string | undefined;
  return envKey ?? '';
};

export type Project = { id: string; name: string; quotaBytes: number; usedBytes: number };
export type Asset = {
  id: string;
  projectId: string;
  r2Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  folder: string | null;
  tags: string[] | null;
  createdAt: number;
};

export const fetchProjects = async (): Promise<Project[]> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const res = await fetch(`${base}/projects?page=1&limit=100`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`projects ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: { items: Project[] } };
  return body.data.items;
};

export const createProject = async (name: string): Promise<Project> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const res = await fetch(`${base}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`create project ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: Project };
  return body.data;
};

export const listAssets = async (params: {
  projectId: string;
  folder?: string;
  tag?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: Asset[]; meta: { hasNextPage: boolean; nextCursor: string | null } }> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const usp = new URLSearchParams({ projectId: params.projectId });
  if (params.folder !== undefined && params.folder !== '') usp.set('folder', params.folder);
  if (params.tag !== undefined && params.tag !== '') usp.set('tag', params.tag);
  if (params.q !== undefined && params.q !== '') usp.set('q', params.q);
  if (params.limit !== undefined) usp.set('limit', String(params.limit));
  if (params.cursor !== undefined && params.cursor !== '') usp.set('cursor', params.cursor);
  const res = await fetch(`${base}/assets?${usp.toString()}`, { headers: { 'x-api-key': key } });
  if (!res.ok) throw new Error(`assets ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: { items: Asset[]; meta: { hasNextPage: boolean; nextCursor: string | null } } };
  return body.data;
};

export const initUpload = async (input: {
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  folder?: string;
  tags?: string[];
}): Promise<{ assetId: string; r2Key: string; url: string; expiresAt: number }> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const res = await fetch(`${base}/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`init ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data: { assetId: string; r2Key: string; url: string; expiresAt: number } };
  return body.data;
};

export const confirmUpload = async (assetId: string): Promise<void> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const res = await fetch(`${base}/upload/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ assetId }),
  });
  if (!res.ok) throw new Error(`confirm ${res.status}: ${await res.text()}`);
};

export const getAssetContentUrl = (assetId: string, opts?: { width?: number; format?: string; quality?: number }): string => {
  const base = getBaseUrl();
  const usp = new URLSearchParams();
  if (opts?.width !== undefined) usp.set('width', String(opts.width));
  if (opts?.format !== undefined) usp.set('format', opts.format);
  if (opts?.quality !== undefined) usp.set('quality', String(opts.quality));
  const qs = usp.toString();
  return `${base}/assets/${assetId}/content${qs !== '' ? `?${qs}` : ''}`;
};

export const deleteAsset = async (assetId: string): Promise<void> => {
  const base = getBaseUrl();
  const key = getApiKey();
  const res = await fetch(`${base}/assets/${assetId}`, { method: 'DELETE', headers: { 'x-api-key': key } });
  if (!res.ok && res.status !== 204) throw new Error(`delete ${res.status}: ${await res.text()}`);
};

export const saveSettings = (baseUrl: string, apiKey: string): void => {
  window.localStorage.setItem('uploadDewekBaseUrl', baseUrl);
  window.localStorage.setItem('uploadDewekApiKey', apiKey);
};

export const loadSettings = (): { baseUrl: string; apiKey: string } => ({
  baseUrl: getBaseUrl(),
  apiKey: getApiKey(),
});
