const statusEl  = document.getElementById('status');
const countEl   = document.getElementById('count');
const syncEl    = document.getElementById('last-sync');
const rowCount  = document.getElementById('row-count');
const rowSync   = document.getElementById('row-sync');
const btnLogin  = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');

function formatTime(ts) {
  if (!ts) return '없음';
  const d = new Date(ts);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
    btnLogin.hidden = true;
    btnLogout.hidden = false;
  } else {
    statusEl.textContent = '로그인 필요';
    statusEl.className = 'badge off';
    rowCount.hidden = true;
    rowSync.hidden = true;
    btnLogin.hidden = false;
    btnLogout.hidden = true;
  }
}

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
