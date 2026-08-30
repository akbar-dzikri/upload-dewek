import { useCallback, useEffect, useState } from 'react';
import {
  createProject,
  deleteAsset,
  fetchProjects,
  getAssetContentUrl,
  initUpload,
  confirmUpload,
  listAssets,
  loadSettings,
  saveSettings,
  type Asset,
  type Project,
} from './lib/client';

export default function App() {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setBaseUrl(s.baseUrl);
    setApiKey(s.apiKey);
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const handleSaveSettings = () => {
    saveSettings(baseUrl, apiKey);
    window.location.reload();
  };

  const loadProjects = useCallback(async () => {
    try {
      setError(null);
      const items = await fetchProjects();
      setProjects(items);
      if (items.length > 0 && selectedProjectId === '') {
        setSelectedProjectId(items[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selectedProjectId]);

  const loadAssets = useCallback(async () => {
    if (selectedProjectId === '') return;
    setLoading(true);
    setError(null);
    try {
      const data = await listAssets({
        projectId: selectedProjectId,
        folder: folder || undefined,
        tag: tag || undefined,
        q: q || undefined,
        limit: 50,
      });
      setAssets(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, folder, tag, q]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (name === '') return;
    try {
      const p = await createProject(name);
      setProjects((prev) => [...prev, p]);
      setSelectedProjectId(p.id);
      setNewProjectName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (files === null || selectedProjectId === '') return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4'];
        if (!allowed.includes(file.type)) {
          setError(`mime not allowed: ${file.type} — allowed ${allowed.join(', ')}`);
          continue;
        }
        const init = await initUpload({
          projectId: selectedProjectId,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          folder: folder || undefined,
          tags: tag !== '' ? [tag] : undefined,
        });
        // Zero-compute: direct PUT to R2 via presigned URL (binary never touches Worker)
        const putRes = await fetch(init.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
        if (!putRes.ok) throw new Error(`R2 PUT ${putRes.status}: ${await putRes.text()}`);
        await confirmUpload(init.assetId);
      }
      await loadAssets();
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const copyLink = async (assetId: string, opts?: { width?: number; format?: string; quality?: number }) => {
    const url = getAssetContentUrl(assetId, opts);
    await navigator.clipboard.writeText(url);
    setCopied(assetId + JSON.stringify(opts ?? {}));
    setTimeout(() => setCopied(null), 1500);
  };

  const handleDelete = async (assetId: string) => {
    try {
      await deleteAsset(assetId);
      await loadAssets();
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Upload Dewek</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.7 }}>
          Solo Control Plane — <code>create project → folder/tag → upload → get links → use</code>. Forkable, BYO $0 Cloudflare.
          <br />
          <span style={{ fontSize: 12 }}>API: <code>{baseUrl || 'http://localhost:8787'}</code> · Centralized for all your projects</span>
        </p>
      </header>

      <section style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Worker URL</div>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://upload-dewek.<you>.workers.dev" style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 8 }} />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>x-api-key</div>
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ud_..." style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 8 }} />
        </label>
        <button onClick={handleSaveSettings} style={{ padding: '10px 16px', borderRadius: 8, background: '#111', color: '#fff', border: 'none', fontWeight: 600, height: 40 }}>Save & Reload</button>
      </section>

      {error !== null && <div style={{ background: '#fee', border: '1px solid #fcc', padding: 12, borderRadius: 8, marginBottom: 16, whiteSpace: 'pre-wrap' }}>{error}</div>}

      <section style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', minWidth: 220 }}>
          <option value="">— select project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.id.slice(0, 8)})</option>
          ))}
        </select>
        <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="new project name" style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }} />
        <button onClick={() => void handleCreateProject()} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #111', background: '#fff', fontWeight: 600 }}>Create project</button>
        {selectedProject !== null && (
          <span style={{ fontSize: 12, opacity: 0.7, marginLeft: 8 }}>
            Quota: {(selectedProject.usedBytes / 1024).toFixed(1)}KB / {(selectedProject.quotaBytes / 1024 / 1024).toFixed(1)}MB
            <span style={{ display: 'inline-block', width: 100, height: 6, background: '#eee', borderRadius: 3, marginLeft: 8, verticalAlign: 'middle', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (selectedProject.usedBytes / selectedProject.quotaBytes) * 100)}%`, background: '#111' }} />
            </span>
          </span>
        )}
      </section>

      <section style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="folder e.g. blog/hero" style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', flex: 1, minWidth: 160 }} />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="tag e.g. hero" style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', flex: 1, minWidth: 160 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search filename (q)" style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc', flex: 1, minWidth: 160 }} />
        <button onClick={() => void loadAssets()} style={{ padding: '10px 16px', borderRadius: 8, background: '#eee', border: '1px solid #ccc', fontWeight: 600 }}>Filter</button>
      </section>

      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
        style={{ border: '2px dashed #ccc', borderRadius: 12, padding: 24, textAlign: 'center', marginBottom: 16, background: uploading ? '#fafafa' : '#fff' }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{uploading ? 'Uploading...' : 'Drop files here or click to browse'}</div>
        <input type="file" multiple onChange={(e) => void handleFiles(e.target.files)} disabled={uploading || selectedProjectId === ''} />
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>Presigned PUT direct to R2 (binary never touches Worker) → auto confirm → validated</div>
        {selectedProjectId === '' && <div style={{ marginTop: 8, fontSize: 12, color: '#a00' }}>Select a project first</div>}
      </section>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.6 }}>Loading...</div>
      ) : assets.length === 0 ? (
        <div style={{ opacity: 0.6, padding: 40, textAlign: 'center', border: '1px solid #eee', borderRadius: 12 }}>No assets — pick project/folder/tag or upload.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {assets.map((a) => (
            <div key={a.id} style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
              <img
                src={getAssetContentUrl(a.id, { width: 400, format: 'webp', quality: 80 })}
                alt={a.filename}
                style={{ width: '100%', height: 180, objectFit: 'cover', background: '#f5f5f5' }}
                loading="lazy"
              />
              <div style={{ padding: 12, flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div title={a.filename} style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.filename}</div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                  {a.folder ?? '—'} {a.tags !== null && a.tags.length > 0 ? `· ${a.tags.join(', ')}` : ''} · {a.status} · {(a.sizeBytes / 1024).toFixed(1)}KB
                </div>
                <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2, wordBreak: 'break-all' }}>{a.r2Key}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => void copyLink(a.id)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: copied === a.id ? '#111' : '#fff', color: copied === a.id ? '#fff' : '#111', fontWeight: 600 }}>
                    {copied === a.id ? 'Copied!' : 'Copy link'}
                  </button>
                  <button onClick={() => void copyLink(a.id, { width: 800, format: 'webp', quality: 80 })} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', background: copied === `${a.id}{"width":800}` ? '#111' : '#fff', color: copied === `${a.id}{"width":800}` ? '#fff' : '#111' }}>
                    {copied === `${a.id}{"width":800}` ? 'Copied!' : 'Copy 800/webp'}
                  </button>
                  <button onClick={() => void handleDelete(a.id)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '1px solid #fcc', color: '#a00', background: '#fff' }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 12, opacity: 0.6 }}>
        Upload Dewek — fork on GitHub, set <code>VITE_UPLOAD_DEWEK_URL</code> + <code>VITE_UPLOAD_DEWEK_API_KEY</code> or use Settings above. Zero-compute: <code>init → PUT presigned → confirm</code>. Images: <code>?width=&format=&quality=</code>
      </footer>
    </div>
  );
}
