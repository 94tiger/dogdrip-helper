const extensionApplied = new Set();
let knownIds = new Set();

// ─── 게시글 생성 시각 추출 ────────────────────────────────────────────────────

function parseRelativeTime(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const now = Date.now();

  if (t === '방금 전') return now;

  let m;
  if ((m = t.match(/(\d+)\s*분\s*전/)))   return now - m[1] * 60_000;
  if ((m = t.match(/(\d+)\s*시간\s*전/))) return now - m[1] * 3_600_000;
  if ((m = t.match(/(\d+)\s*일\s*전/)))   return now - m[1] * 86_400_000;

  if ((m = t.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/))) {
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})$/))) {
    const year = new Date().getFullYear();
    const ts = new Date(year, +m[1] - 1, +m[2]).getTime();
    return ts > now ? new Date(year - 1, +m[1] - 1, +m[2]).getTime() : ts;
  }

  return now;
}

function getPostTimestamp(el) {
  const li = el.closest('li');
  const clockIcon = li?.querySelector('.fa-clock');
  const text = clockIcon?.parentElement?.textContent || '';
  return parseRelativeTime(text);
}

// ─── DOM 조작 ─────────────────────────────────────────────────────────────────

// 메인 위젯(<a> + 내부 <span>)과 게시물 목록(a.title-link) 모두
// data-document-srl 속성을 가지므로 [data-document-srl]로 통합 처리
function applyVisited(ids) {
  const idSet = new Set(ids);
  document.querySelectorAll('[data-document-srl]:not(.visited)').forEach(el => {
    const id = el.dataset.documentSrl;
    if (idSet.has(id)) {
      extensionApplied.add(id);
      el.classList.add('visited');
    }
  });
}

function collectNativeVisited() {
  const seen = new Set();
  const entries = [];
  document.querySelectorAll('[data-document-srl].visited').forEach(el => {
    const id = el.dataset.documentSrl;
    if (!extensionApplied.has(id) && !seen.has(id)) {
      seen.add(id);
      entries.push({ id, ts: getPostTimestamp(el) });
    }
  });
  return entries;
}

function startObserver() {
  const observer = new MutationObserver(mutations => {
    const newEntries = [];
    const seen = new Set();

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        const els = [];
        if (node.matches('[data-document-srl]')) els.push(node);
        node.querySelectorAll('[data-document-srl]').forEach(e => els.push(e));

        for (const el of els) {
          const id = el.dataset.documentSrl;
          if (el.classList.contains('visited')) {
            if (!extensionApplied.has(id) && !seen.has(id)) {
              seen.add(id);
              newEntries.push({ id, ts: getPostTimestamp(el) });
            }
          } else if (knownIds.has(id)) {
            extensionApplied.add(id);
            el.classList.add('visited');
          }
        }
      }

      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const el = mutation.target;
        if (el.dataset?.documentSrl && el.classList.contains('visited')) {
          const id = el.dataset.documentSrl;
          if (!extensionApplied.has(id) && !seen.has(id)) {
            seen.add(id);
            newEntries.push({ id, ts: getPostTimestamp(el) });
          }
        }
      }
    }

    if (newEntries.length > 0) {
      newEntries.forEach(e => knownIds.add(e.id));
      chrome.runtime.sendMessage({ type: 'ADD_READ_ENTRIES', entries: newEntries });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

// ─── 클릭 감지 ───────────────────────────────────────────────────────────────

function startClickListener() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[data-document-srl]');
    if (!link) return;
    const id = link.dataset.documentSrl;
    if (knownIds.has(id)) return; // 이미 알고 있는 경우 스킵
    knownIds.add(id);
    // 클릭 즉시 시각적으로도 반영
    extensionApplied.add(id);
    document.querySelectorAll(`[data-document-srl="${id}"]`).forEach(el => el.classList.add('visited'));
    chrome.runtime.sendMessage({ type: 'ADD_READ_ENTRIES', entries: [{ id, ts: getPostTimestamp(link) }] });
  }, true); // capture phase: 페이지 이동 전에 확실히 실행
}

// ─── 초기화 ───────────────────────────────────────────────────────────────────

async function init() {
  const { ids = [] } = await chrome.runtime.sendMessage({ type: 'GET_IDS' });
  knownIds = new Set(ids);

  applyVisited(ids);

  const nativeEntries = collectNativeVisited();
  if (nativeEntries.length > 0) {
    nativeEntries.forEach(e => knownIds.add(e.id));
    chrome.runtime.sendMessage({ type: 'ADD_READ_ENTRIES', entries: nativeEntries });
  }

  startClickListener();
  startObserver();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.local_entries?.newValue) {
    const ids = changes.local_entries.newValue.map(e => e.id);
    ids.forEach(id => knownIds.add(id));
    applyVisited(ids);
  }
});

init();
