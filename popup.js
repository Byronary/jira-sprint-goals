const toggle = document.getElementById('enabled-toggle');

chrome.storage.local.get('jsg-enabled', (data) => {
  toggle.checked = data['jsg-enabled'] !== false;
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ 'jsg-enabled': enabled });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: 'jsg-toggle', enabled }).catch(() => {});
  });
});
