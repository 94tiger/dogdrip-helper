// ─── 읽음 동기화 ──────────────────────────────────────────────────────────────

const LS_KEY = 'visited_documents';

// setLocalIds는 오버라이드 전 원본 setItem을 사용해야 무한루프 방지
const _origSetItem = localStorage.setItem.bind(localStorage);

function getLocalIds() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function setLocalIds(ids) {
  _origSetItem(LS_KEY, JSON.stringify(ids));
}

function applyVisited(ids) {
  const idSet = new Set(ids);
  document.querySelectorAll('[data-document-srl]:not(.visited)').forEach(el => {
    if (idSet.has(el.dataset.documentSrl)) el.classList.add('visited');
  });
}

let knownIds = new Set();

function syncNewLocalReads() {
  const localIds = getLocalIds();
  const newIds = localIds.filter(id => !knownIds.has(id));
  if (newIds.length === 0) return;
  newIds.forEach(id => knownIds.add(id));
  try {
    chrome.runtime.sendMessage({
      type: 'ADD_READ_ENTRIES',
      entries: newIds.map(id => ({ id, ts: Date.now() })),
    }).catch(() => {});
  } catch {}
}

// ─── 차단 ────────────────────────────────────────────────────────────────────

let blockedSrls = new Set();
let pendingMember = null;

function getMemberNickname(link) {
  return [...link.childNodes]
    .filter(n => n.nodeType === Node.TEXT_NODE)
    .map(n => n.textContent.trim())
    .filter(Boolean)
    .join('');
}

function applyBlocksToDOM() {
  blockedSrls.forEach(srl => {
    document.querySelectorAll(`a.member_${srl}`).forEach(el => {
      const container = el.closest('.comment-item') || el.closest('li') || el.closest('tr');
      if (!container || container.dataset.ddBlocked) return;
      container.dataset.ddBlocked = srl;

      // 기존 내용을 숨김 wrapper로 이동
      const wrapper = document.createElement('div');
      wrapper.className = 'dd-blocked-content';
      wrapper.style.display = 'none';
      [...container.childNodes].forEach(n => wrapper.appendChild(n));

      const placeholder = document.createElement('div');
      placeholder.className = 'dd-blocked-placeholder';
      placeholder.style.cssText = 'padding:6px 12px;color:rgba(128,128,128,0.85);font-size:12px;cursor:pointer;background:rgba(128,128,128,0.15);border-radius:4px;';
      placeholder.textContent = '차단된 사용자의 댓글입니다. (클릭하면 표시)';
      placeholder.addEventListener('click', () => {
        if (confirm('차단된 사용자의 댓글입니다.\n확인하시겠습니까?')) {
          placeholder.remove();
          wrapper.style.display = '';
        }
      });

      container.appendChild(wrapper);
      container.appendChild(placeholder);
    });
  });
}

function injectBlockButton(popup, srl, nickname) {
  if (popup.querySelector('.dd-block-btn')) return;

  const ul = popup.querySelector('ul');
  if (!ul) return;

  const isBlocked = blockedSrls.has(srl);

  const li = document.createElement('li');
  const a = document.createElement('a');
  a.className = 'dd-block-btn';
  a.href = '#';
  a.style.color = isBlocked ? '#888' : '#e84a5f';
  a.textContent = isBlocked ? '차단 해제' : '차단';

  a.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (isBlocked) {
      await chrome.runtime.sendMessage({ type: 'REMOVE_BLOCK', srl });
      blockedSrls.delete(srl);
      document.querySelectorAll(`a.member_${srl}`).forEach(el => {
        const container = el.closest('[data-dd-blocked]');
        if (!container) return;
        delete container.dataset.ddBlocked;
        container.querySelector('.dd-blocked-placeholder')?.remove();
        const wrapper = container.querySelector('.dd-blocked-content');
        if (wrapper) {
          [...wrapper.childNodes].forEach(n => container.insertBefore(n, wrapper));
          wrapper.remove();
        }
      });
    } else {
      const memo = prompt(`[${nickname}] 차단\n메모를 입력하세요 (선택사항):`, '');
      if (memo === null) return;
      await chrome.runtime.sendMessage({
        type: 'ADD_BLOCK',
        block: { srl, nickname, memo, date: new Date().toISOString() },
      });
      blockedSrls.add(srl);
      applyBlocksToDOM();
    }

    popup.style.display = 'none';
  });

  li.appendChild(a);
  ul.appendChild(li);
}

function attachPopupObserver(popup) {
  const observer = new MutationObserver(() => {
    if (popup.style.display === 'none') return;

    const anchor = popup.querySelector('a[href*="member_srl="]');
    if (!anchor) return;
    const match = anchor.href.match(/member_srl=(\d+)/);
    if (!match) return;
    const srl = match[1];

    const nickname = pendingMember?.nickname
      || getMemberNickname(document.querySelector(`a.member_${srl}`) || { childNodes: [] })
      || '';

    injectBlockButton(popup, srl, nickname);
  });

  observer.observe(popup, {
    attributes: true,
    attributeFilter: ['style'],
    childList: true,
    subtree: true,
  });
}

function observeMemberPopup() {
  const popup = document.getElementById('popup_menu_area');
  if (popup) {
    attachPopupObserver(popup);
    return;
  }

  // 팝업이 아직 DOM에 없으면 body를 감시하다가 생기면 attach
  const bodyObserver = new MutationObserver((_, obs) => {
    const p = document.getElementById('popup_menu_area');
    if (p) {
      obs.disconnect();
      attachPopupObserver(p);
    }
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href="#popup_menu_area"]');
  if (!link) return;
  pendingMember = { nickname: getMemberNickname(link) };
}, true);

// ─── 초기화 ───────────────────────────────────────────────────────────────────

let lsOverrideActive = false;

function setupLsOverride() {
  if (lsOverrideActive) return;
  lsOverrideActive = true;
  localStorage.setItem = (key, value) => {
    _origSetItem(key, value);
    if (key === LS_KEY) syncNewLocalReads();
  };
}

function teardownLsOverride() {
  if (!lsOverrideActive) return;
  lsOverrideActive = false;
  localStorage.setItem = _origSetItem;
}

async function init() {
  try {
    const { ids: driveIds = [] } = await chrome.runtime.sendMessage({ type: 'GET_IDS' });
    const localIds = getLocalIds();

    const driveSet = new Set(driveIds);
    const unsynced = localIds.filter(id => !driveSet.has(id));
    if (unsynced.length > 0) {
      chrome.runtime.sendMessage({
        type: 'ADD_READ_ENTRIES',
        entries: unsynced.map(id => ({ id, ts: Date.now() })),
      }).catch(() => {});
    }

    const merged = [...new Set([...localIds, ...driveIds])];
    setLocalIds(merged);
    knownIds = new Set(merged);
    applyVisited(driveIds);
    setupLsOverride();

    const { blocks = [] } = await chrome.runtime.sendMessage({ type: 'GET_BLOCKS' });
    blockedSrls = new Set(blocks.map(b => b.srl));
    applyBlocksToDOM();
    observeMemberPopup();
  } catch (e) {
    // service worker가 아직 안 떠있으면 2초 후 재시도
    if (e?.message?.includes('Could not establish connection')) {
      setTimeout(() => init().catch(() => {}), 2000);
    }
  }
}

// bfcache 진입 전 override 해제 → 복원된 페이지에서 invalid context 에러 방지
window.addEventListener('pagehide', teardownLsOverride);
// bfcache에서 복원 시 재초기화
window.addEventListener('pageshow', (e) => { if (e.persisted) init().catch(() => {}); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.local_entries?.newValue) return;
  const ids = changes.local_entries.newValue.map(e => e.id);
  ids.forEach(id => knownIds.add(id));
  const current = getLocalIds();
  setLocalIds([...new Set([...current, ...ids])]);
  applyVisited(ids);
});

init().catch(() => {});
