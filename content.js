// 확장 프로그램이 직접 추가한 visited 클래스를 추적 (새 방문과 구분하기 위함)
const extensionApplied = new Set();

// knownIds: 현재 기기+Drive에서 읽은 것으로 알려진 모든 ID
let knownIds = new Set();

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
  // 페이지 로드 시 dogdrip이 이미 visited 처리한 것들 (확장 적용분 제외)
  const ids = [];
  document.querySelectorAll('a.title-link.visited[data-document-srl]').forEach(link => {
    const srl = link.dataset.documentSrl;
    if (!extensionApplied.has(srl)) ids.push(srl);
  });
  return ids;
}

function startObserver() {
  const observer = new MutationObserver(mutations => {
    const newVisited = [];

    for (const mutation of mutations) {
      // 동적 로딩(무한스크롤 등)으로 새 노드가 추가된 경우
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        const links = [];
        if (node.matches('a.title-link[data-document-srl]')) links.push(node);
        node.querySelectorAll('a.title-link[data-document-srl]').forEach(l => links.push(l));

        for (const link of links) {
          const srl = link.dataset.documentSrl;
          if (link.classList.contains('visited')) {
            // 서버/dogdrip JS가 이미 visited로 준 경우
            if (!extensionApplied.has(srl)) newVisited.push(srl);
          } else if (knownIds.has(srl)) {
            // 새로 로드된 게시물이지만 다른 기기에서 읽은 것
            extensionApplied.add(srl);
            link.classList.add('visited');
          }
        }
      }

      // 기존 요소의 class 변경 (클릭으로 visited 추가)
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const el = mutation.target;
        if (el.matches('a.title-link.visited[data-document-srl]')) {
          const srl = el.dataset.documentSrl;
          if (!extensionApplied.has(srl)) newVisited.push(srl);
        }
      }
    }

    if (newVisited.length > 0) {
      newVisited.forEach(id => knownIds.add(id));
      chrome.runtime.sendMessage({ type: 'ADD_READ_IDS', ids: newVisited });
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

async function init() {
  // 백그라운드에서 동기화된 ID 가져오기
  const { ids = [] } = await chrome.runtime.sendMessage({ type: 'GET_IDS' });
  knownIds = new Set(ids);

  // 다른 기기에서 읽은 게시물에 visited 적용
  applyVisited(ids);

  // 이 기기에서 이미 읽은 게시물을 백그라운드에 보고
  const nativeVisited = collectNativeVisited();
  if (nativeVisited.length > 0) {
    nativeVisited.forEach(id => knownIds.add(id));
    chrome.runtime.sendMessage({ type: 'ADD_READ_IDS', ids: nativeVisited });
  }

  startObserver();
}

// Drive 동기화 후 storage가 업데이트되면 자동으로 반영
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.local_ids?.newValue) {
    const updated = changes.local_ids.newValue;
    updated.forEach(id => knownIds.add(id));
    applyVisited(updated);
  }
});

init();
