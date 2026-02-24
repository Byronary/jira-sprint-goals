chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.sendMessage(details.tabId, { type: 'jsg-navigation' }).catch(() => {
      // Content script not yet injected — safe to ignore
    });
  },
  { url: [{ hostSuffix: '.atlassian.net' }] }
);

chrome.webNavigation.onCompleted.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.sendMessage(details.tabId, { type: 'jsg-navigation' }).catch(() => {});
  },
  { url: [{ hostSuffix: '.atlassian.net' }] }
);
