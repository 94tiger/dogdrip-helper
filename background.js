// config.js는 gitignore됩니다. config.example.js를 복사해서 만드세요.
importScripts('config.js');

const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'dogdrip-read.json';
const RETENTION_DEFAULT_DAYS = 7;

// ─── Entries 유틸 ────────────────────────────────────────────────────────────

// 두 entries 배열을 id 기준 합집합으로 머지 (같은 id면 더 최신 ts 유지)
function mergeEntries(a, b) {
  const map = new Map();
  for (const e of [...a, ...b]) {
    const cur = map.get(e.id);
    if (!cur || cur.ts > e.ts) map.set(e.id, e);
  }
  return [...map.values()];
}

// retentionDays가 0이면 무제한, 아니면 ts 기준으로 오래된 항목 제거
function purgeOldEntries(entries, retentionDays) {
  if (retentionDays === 0) return entries;
  const cutoff = Date.now() - retentionDays * 86_400_000;
  return entries.filter(e => e.ts >= cutoff);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function buildAuthUrl(interactive) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', chrome.identity.getRedirectURL());
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', SCOPES);
  if (!interactive) url.searchParams.set('prompt', 'none');
  return url.toString();
}

function extractToken(responseUrl) {
  const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  const token = params.get('access_token');
  if (!token) throw new Error('access_token not found');
  const expiresIn = parseInt(params.get('expires_in') || '3600');
  return { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
}

function launchAuth(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: buildAuthUrl(interactive), interactive },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'Auth cancelled'));
        } else {
          try { resolve(extractToken(responseUrl)); }
          catch (e) { reject(e); }
        }
      }
    );
  });
}

async function getToken() {
  const { auth_token, auth_expires_at } = await chrome.storage.local.get(['auth_token', 'auth_expires_at']);
  if (auth_token && auth_expires_at > Date.now()) return auth_token;

  try {
    const { token, expiresAt } = await launchAuth(false);
    await chrome.storage.local.set({ auth_token: token, auth_expires_at: expiresAt });
    return token;
  } catch {
    const { token, expiresAt } = await launchAuth(true);
    await chrome.storage.local.set({ auth_token: token, auth_expires_at: expiresAt });
    return token;
  }
}

// ─── Drive API ───────────────────────────────────────────────────────────────

async function driveRequest(method, path, token, body = null) {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body != null && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`Drive ${method} ${path} → ${res.status}`);
  return res;
}

async function getOrCreateFileId(token) {
  const { drive_file_id } = await chrome.storage.local.get('drive_file_id');
  if (drive_file_id) return drive_file_id;

  const res = await driveRequest(
    'GET',
    `/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${DRIVE_FILE_NAME}'`)}&fields=files(id)`,
    token
  );
  const { files } = await res.json();

  let fileId;
  if (files?.length > 0) {
    fileId = files[0].id;
  } else {
    const createRes = await driveRequest('POST', '/drive/v3/files?fields=id', token, {
      name: DRIVE_FILE_NAME,
      parents: ['appDataFolder'],
    });
    fileId = (await createRes.json()).id;
    await driveRequest('PATCH', `/upload/drive/v3/files/${fileId}?uploadType=media`, token,
      JSON.stringify({ entries: [] }));
  }

  await chrome.storage.local.set({ drive_file_id: fileId });
  return fileId;
}

async function readDriveEntries(fileId, token) {
  const res = await driveRequest('GET', `/drive/v3/files/${fileId}?alt=media`, token);
  const data = await res.json();
  // 구버전 포맷(ids[]) 마이그레이션
  if (data.ids) return data.ids.map(id => ({ id, ts: Date.now() }));
  return data.entries || [];
}

async function writeDriveEntries(fileId, token, entries) {
  await driveRequest('PATCH', `/upload/drive/v3/files/${fileId}?uploadType=media`, token,
    JSON.stringify({ entries }));
}

// ─── Sync ────────────────────────────────────────────────────────────────────

async function sync() {
  const { auth_token, sync_enabled } = await chrome.storage.local.get(['auth_token', 'sync_enabled']);
  if (!auth_token) return;
  if (sync_enabled === false) return;

  try {
    const token = await getToken();
    let fileId;
    try {
      fileId = await getOrCreateFileId(token);
    } catch (e) {
      if (e.message.includes('404')) {
        await chrome.storage.local.remove('drive_file_id');
        fileId = await getOrCreateFileId(token);
      } else throw e;
    }

    const { local_entries: localEntries = [] } = await chrome.storage.local.get('local_entries');
    const { retention_days: retentionDays = RETENTION_DEFAULT_DAYS } = await chrome.storage.local.get('retention_days');

    const driveEntries = await readDriveEntries(fileId, token);
    const merged = mergeEntries(localEntries, driveEntries);
    const purged = purgeOldEntries(merged, retentionDays);

    const hasNewLocal = localEntries.some(e => !driveEntries.find(d => d.id === e.id));
    const hasPurged = purged.length < merged.length;

    if (hasNewLocal || hasPurged) {
      await writeDriveEntries(fileId, token, purged);
    }

    await chrome.storage.local.set({ local_entries: purged, last_sync: Date.now() });
  } catch (err) {
    console.error('[dogdrip-sync] sync 실패:', err.message);
    if (err.message.includes('401')) {
      await chrome.storage.local.remove(['auth_token', 'auth_expires_at']);
    }
  }
}

// ─── Events ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('sync', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'sync') sync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ADD_READ_ENTRIES') {
    chrome.storage.local.get('local_entries', ({ local_entries = [] }) => {
      const merged = mergeEntries(local_entries, msg.entries);
      chrome.storage.local.set({ local_entries: merged }, () => {
        sendResponse({ ok: true });
        sync();
      });
    });
    return true;
  }

  if (msg.type === 'GET_IDS') {
    chrome.storage.local.get('local_entries', ({ local_entries = [] }) => {
      sendResponse({ ids: local_entries.map(e => e.id) });
    });
    return true;
  }

  if (msg.type === 'LOGIN') {
    getToken()
      .then(() => sync())
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === 'LOGOUT') {
    chrome.storage.local.remove(
      ['auth_token', 'auth_expires_at', 'drive_file_id'],
      () => sendResponse({ ok: true })
    );
    return true;
  }

  if (msg.type === 'GET_STATUS') {
    chrome.storage.local.get(['auth_token', 'last_sync', 'local_entries', 'retention_days', 'sync_enabled'], (data) => {
      sendResponse({
        loggedIn: !!data.auth_token,
        lastSync: data.last_sync || null,
        count: (data.local_entries || []).length,
        retentionDays: data.retention_days ?? RETENTION_DEFAULT_DAYS,
        syncEnabled: data.sync_enabled !== false,
      });
    });
    return true;
  }

  if (msg.type === 'SET_SYNC_ENABLED') {
    chrome.storage.local.set({ sync_enabled: msg.enabled }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'SET_RETENTION') {
    chrome.storage.local.set({ retention_days: msg.days }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'GET_BLOCKS') {
    chrome.storage.local.get('blocked_members', ({ blocked_members = [] }) => {
      sendResponse({ blocks: blocked_members });
    });
    return true;
  }

  if (msg.type === 'ADD_BLOCK') {
    chrome.storage.local.get('blocked_members', ({ blocked_members = [] }) => {
      const filtered = blocked_members.filter(b => b.srl !== msg.block.srl);
      chrome.storage.local.set({ blocked_members: [...filtered, msg.block] }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (msg.type === 'REMOVE_BLOCK') {
    chrome.storage.local.get('blocked_members', ({ blocked_members = [] }) => {
      chrome.storage.local.set(
        { blocked_members: blocked_members.filter(b => b.srl !== msg.srl) },
        () => sendResponse({ ok: true })
      );
    });
    return true;
  }
});
