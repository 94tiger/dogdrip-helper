const extensionApplied = new Set();
let knownIds = new Set();

// ─── 게시글 생성 시각 추출 ────────────────────────────────────────────────────

function parseRelativeTime(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const now = Date.now();

  if (t === '방금 전') return now;

  let m;
  if ((m = t.match(/(\d+)\s*분\s*전/)))  return now - m[1] * 60_000;
  if ((m = t.match(/(\d+)\s*시간\s*전/))) return now - m[1] * 3_600_000;
  if ((m = t.match(/(\d+)\s*일\s*전/)))  return now - m[1] * 86_400_000;

  // 절대 날짜: "2024.01.15"
  if ((m = t.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/))) {
    return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }
  // 절대 날짜: "01.15" (연도 없음)
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})$/))) {
    const year = new Date().getFullYear();
    const ts = new Date(year, +m[1] - 1, +m[2]).getTime();
    return ts > now ? new Date(year - 1, +m[1] - 1, +m[2]).getTime() : ts;
  }

  return now;
}

function getPostTimestamp(link) {
  const li = link.closest('li');
  const clockIcon = li?.querySelector('.fa-clock');
  const text = clockIcon?.parentElement?.textContent || '';
  return parseRelativeTime(text);
}

// ─── DOM 조작 ─────────────────────────────────────────────────────────────────

function applyVisited(ids) {
  for (const id of ids) {
    const link = document.querySelector(`a.title-link[data-document-srl="${id}"]:not(.visited)`);
    if (link) {
      extensionApplied.add(id);
      link.classList.add('visited');
    }
  }
}

function collectNativeVisited() {
  const entries = [];
  document.querySelectorAll('a.title-link.visited[data-document-srl]').forEach(link => {
    const id = link.dataset.documentSrl;
    if (!extensionApplied.has(id)) {
      entries.push({ id, ts: getPostTimestamp(link) });
    }
  });
  return entries;
}

function startObserver() {
  const observer = new MutationObserver(mutations => {
    const newEntries = [];

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        const links = [];
        if (node.matches('a.title-link[data-document-srl]')) links.push(node);
        node.querySelectorAll('a.title-link[data-document-srl]').forEach(l => links.push(l));

        for (const link of links) {
          const id = link.dataset.documentSrl;
          if (link.classList.contains('visited')) {
            if (!extensionApplied.has(id)) newEntries.push({ id, ts: getPostTimestamp(link) });
          } else if (knownIds.has(id)) {
            extensionApplied.add(id);
            link.classList.add('visited');
          }
        }
      }

      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const el = mutation.target;
        if (el.matches('a.title-link.visited[data-document-srl]')) {
          const id = el.dataset.documentSrl;
          if (!extensionApplied.has(id)) newEntries.push({ id, ts: getPostTimestamp(el) });
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
