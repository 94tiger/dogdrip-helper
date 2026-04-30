// ─── 탭 전환 ─────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
    if (tab.dataset.panel === 'blocks') loadBlocks();
  });
});

// ─── 동기화 탭 ───────────────────────────────────────────────────────────────

const statusEl      = document.getElementById('status');
const countEl       = document.getElementById('count');
const syncEl        = document.getElementById('last-sync');
const rowCount      = document.getElementById('row-count');
const rowSync       = document.getElementById('row-sync');
const rowSyncToggle = document.getElementById('row-sync-toggle');
const syncToggle    = document.getElementById('sync-toggle');
const rowRetention  = document.getElementById('row-retention');
const retentionSel  = document.getElementById('retention');
const btnLogin      = document.getElementById('btn-login');
const btnLogout     = document.getElementById('btn-logout');

function formatTime(ts) {
  if (!ts) return '없음';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function updateSync() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

  if (status.loggedIn) {
    const enabled = status.syncEnabled !== false;
    statusEl.textContent = enabled ? '동기화 중' : '일시정지';
    statusEl.className = enabled ? 'badge on' : 'badge pause';
    countEl.textContent = status.count.toLocaleString() + '개';
    syncEl.textContent = formatTime(status.lastSync);
    rowCount.hidden = false;
    rowSync.hidden = false;
    rowSyncToggle.hidden = false;
    rowRetention.hidden = false;
    syncToggle.checked = enabled;
    btnLogin.hidden = true;
    btnLogout.hidden = false;

    const val = String(status.retentionDays);
    if ([...retentionSel.options].some(o => o.value === val)) {
      retentionSel.value = val;
    }
  } else {
    statusEl.textContent = '로그인 필요';
    statusEl.className = 'badge off';
    rowCount.hidden = true;
    rowSync.hidden = true;
    rowSyncToggle.hidden = true;
    rowRetention.hidden = true;
    btnLogin.hidden = false;
    btnLogout.hidden = true;
  }
}

syncToggle.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'SET_SYNC_ENABLED', enabled: syncToggle.checked });
  await updateSync();
});

retentionSel.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({ type: 'SET_RETENTION', days: parseInt(retentionSel.value) });
});

btnLogin.addEventListener('click', async () => {
  btnLogin.disabled = true;
  btnLogin.textContent = '로그인 중...';
  const result = await chrome.runtime.sendMessage({ type: 'LOGIN' });
  if (result?.error) {
    alert('로그인 실패: ' + result.error);
    btnLogin.disabled = false;
    btnLogin.textContent = 'Google로 로그인';
  } else {
    await updateSync();
  }
});

btnLogout.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  await updateSync();
});

// ─── 차단 탭 ─────────────────────────────────────────────────────────────────

const blockEmpty = document.getElementById('block-empty');
const blockList  = document.getElementById('block-list');

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

async function loadBlocks() {
  const { blocks = [] } = await chrome.runtime.sendMessage({ type: 'GET_BLOCKS' });

  if (blocks.length === 0) {
    blockEmpty.hidden = false;
    blockList.innerHTML = '';
    return;
  }

  blockEmpty.hidden = true;
  blockList.innerHTML = blocks.slice().reverse().map(b => `
    <li class="block-item">
      <div class="block-info">
        <div class="block-nick">${b.nickname} <span style="color:#bbb;font-size:10px;">#${b.srl}</span></div>
        ${b.memo ? `<div class="block-memo">${b.memo}</div>` : ''}
        <div class="block-date">${formatDate(b.date)}</div>
      </div>
      <button class="btn-remove" data-srl="${b.srl}">해제</button>
    </li>
  `).join('');
}

blockList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-remove');
  if (!btn) return;
  await chrome.runtime.sendMessage({ type: 'REMOVE_BLOCK', srl: btn.dataset.srl });
  loadBlocks();
});

// ─── 초기화 ──────────────────────────────────────────────────────────────────

updateSync();
