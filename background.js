// Content script init + debounced navigation handler cover full loads and SPA transitions.
// onCompleted duplicated onHistoryStateUpdated and caused double inject on refresh.
chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    chrome.tabs.sendMessage(details.tabId, { type: 'jsg-navigation' }).catch(() => {
      // Content script not yet injected — safe to ignore
    });
  },
  { url: [{ hostSuffix: '.atlassian.net' }] }
);
