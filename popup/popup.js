const statusEl   = document.getElementById('status');
const countEl    = document.getElementById('count');
const syncEl     = document.getElementById('last-sync');
const rowCount   = document.getElementById('row-count');
const rowSync    = document.getElementById('row-sync');
const rowRetention = document.getElementById('row-retention');
const retentionSel = document.getElementById('retention');
const btnLogin   = document.getElementById('btn-login');
const btnLogout  = document.getElementById('btn-logout');

function formatTime(ts) {
  if (!ts) return '없음';
  return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function updateUI() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });

  if (status.loggedIn) {
    statusEl.textContent = '동기화 중';
    statusEl.className = 'badge on';
    countEl.textContent = status.count.toLocaleString() + '개';
    syncEl.textContent = formatTime(status.lastSync);
    rowCount.hidden = false;
    rowSync.hidden = false;
    rowRetention.hidden = false;
    btnLogin.hidden = true;
    btnLogout.hidden = false;

    // 현재 설정값 반영
    const val = String(status.retentionDays);
    if ([...retentionSel.options].some(o => o.value === val)) {
      retentionSel.value = val;
    }
  } else {
    statusEl.textContent = '로그인 필요';
    statusEl.className = 'badge off';
    rowCount.hidden = true;
    rowSync.hidden = true;
    rowRetention.hidden = true;
    btnLogin.hidden = false;
    btnLogout.hidden = true;
  }
}

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
    await updateUI();
  }
});

btnLogout.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'LOGOUT' });
  await updateUI();
});

updateUI();
