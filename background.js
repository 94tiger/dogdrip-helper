// Google Cloud Console에서 발급받은 OAuth 2.0 클라이언트 ID로 교체하세요.
// 생성 방법: console.cloud.google.com → API 및 서비스 → 사용자 인증 정보
// → OAuth 클라이언트 ID 만들기 → Chrome 앱 선택
// Authorized redirect URI에 chrome.identity.getRedirectURL() 반환값 추가 필요
const CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID.apps.googleusercontent.com';

const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
const DRIVE_FILE_NAME = 'dogdrip-read.json';

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

  // 먼저 조용히 재인증 시도, 실패하면 팝업 띄우기
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
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
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
    await driveRequest(
      'PATCH',
      `/upload/drive/v3/files/${fileId}?uploadType=media`,
      token,
      JSON.stringify({ ids: [] })
    );
  }

  await chrome.storage.local.set({ drive_file_id: fileId });
  return fileId;
}

async function readDriveIds(fileId, token) {
  const res = await driveRequest('GET', `/drive/v3/files/${fileId}?alt=media`, token);
  const data = await res.json();
  return data.ids || [];
}

async function writeDriveIds(fileId, token, ids) {
  await driveRequest(
    'PATCH',
    `/upload/drive/v3/files/${fileId}?uploadType=media`,
    token,
    JSON.stringify({ ids })
  );
}

// ─── Sync ────────────────────────────────────────────────────────────────────

async function sync() {
  const { auth_token } = await chrome.storage.local.get('auth_token');
  if (!auth_token) return; // 로그인 전에는 동기화 스킵

  try {
    const token = await getToken();
    let fileId;
    try {
      fileId = await getOrCreateFileId(token);
    } catch (e) {
      // 캐시된 파일 ID가 유효하지 않으면 초기화 후 재시도
      if (e.message.includes('404')) {
        await chrome.storage.local.remove('drive_file_id');
        fileId = await getOrCreateFileId(token);
      } else throw e;
    }

    const { local_ids: localIds = [] } = await chrome.storage.local.get('local_ids');
    const driveIds = await readDriveIds(fileId, token);

    const merged = [...new Set([...localIds, ...driveIds])];
    const hasNewLocal = localIds.some(id => !driveIds.includes(id));

    if (hasNewLocal) {
      await writeDriveIds(fileId, token, merged);
    }

    await chrome.storage.local.set({ local_ids: merged, last_sync: Date.now() });
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

// 서비스 워커 재시작 후에도 알람 유지를 위해 리스너 등록
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'sync') sync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ADD_READ_IDS') {
    chrome.storage.local.get('local_ids', ({ local_ids = [] }) => {
      const merged = [...new Set([...local_ids, ...msg.ids])];
      chrome.storage.local.set({ local_ids: merged }, () => {
        sendResponse({ ok: true });
        sync();
      });
    });
    return true;
  }

  if (msg.type === 'GET_IDS') {
    chrome.storage.local.get('local_ids', ({ local_ids = [] }) => {
      sendResponse({ ids: local_ids });
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
    chrome.storage.local.get(['auth_token', 'last_sync', 'local_ids'], (data) => {
      sendResponse({
        loggedIn: !!data.auth_token,
        lastSync: data.last_sync || null,
        count: (data.local_ids || []).length,
      });
    });
    return true;
  }
});
