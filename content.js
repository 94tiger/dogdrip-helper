const LS_KEY = 'visited_documents';

function getLocalIds() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function setLocalIds(ids) {
  localStorage.setItem(LS_KEY, JSON.stringify(ids));
}

// dogdrip의 JS가 이미 실행된 후이므로 Drive에서 온 새 IDs는 직접 클래스 적용
function applyVisited(ids) {
  const idSet = new Set(ids);
  document.querySelectorAll('[data-document-srl]:not(.visited)').forEach(el => {
    if (idSet.has(el.dataset.documentSrl)) el.classList.add('visited');
  });
}

let knownIds = new Set();

// localStorage에 새로 추가된 항목을 Drive로 동기화
function syncNewLocalReads() {
  const localIds = getLocalIds();
  const newIds = localIds.filter(id => !knownIds.has(id));
  if (newIds.length === 0) return;

  newIds.forEach(id => knownIds.add(id));
  chrome.runtime.sendMessage({
    type: 'ADD_READ_ENTRIES',
    entries: newIds.map(id => ({ id, ts: Date.now() })),
  });
}

async function init() {
  const { ids: driveIds = [] } = await chrome.runtime.sendMessage({ type: 'GET_IDS' });

  const localIds = getLocalIds();
  const merged = [...new Set([...localIds, ...driveIds])];

  // Drive에서 받은 IDs를 localStorage에 반영 (dogdrip이 다음 페이지 로드 시 자동 적용)
  setLocalIds(merged);
  knownIds = new Set(merged);

  // 현재 페이지에 이미 떠있는 목록에도 즉시 반영
  applyVisited(driveIds);

  // dogdrip이 클릭 시 localStorage에 쓰는 것을 2초 폴링으로 감지
  setInterval(syncNewLocalReads, 2000);
}

// Drive 동기화 완료 시 localStorage + 현재 페이지 DOM 업데이트
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.local_entries?.newValue) return;

  const ids = changes.local_entries.newValue.map(e => e.id);
  ids.forEach(id => knownIds.add(id));

  const current = getLocalIds();
  const merged = [...new Set([...current, ...ids])];
  setLocalIds(merged);
  applyVisited(ids);
});

init();
