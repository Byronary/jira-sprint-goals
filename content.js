(function () {
  'use strict';

  const BANNER_ID = 'jsg-sprint-goal-banner';
  let currentBoardId = null;
  let currentSprintData = null;
  let cachedDaysText = null;

  // ---------------------------------------------------------------------------
  // URL parsing
  // ---------------------------------------------------------------------------

  function extractBoardId(url) {
    // New nav: /jira/software/projects/{KEY}/boards/{boardId}
    const newNav = url.match(/\/jira\/software\/(?:c\/)?projects\/[^/]+\/boards\/(\d+)/);
    if (newNav) return newNav[1];

    // Classic: /secure/RapidBoard.jspa?rapidView={boardId}
    const classic = url.match(/[?&]rapidView=(\d+)/);
    if (classic) return classic[1];

    return null;
  }

  // ---------------------------------------------------------------------------
  // Jira API
  // ---------------------------------------------------------------------------

  async function fetchActiveSprints(boardId) {
    const resp = await fetch(
      `/rest/agile/1.0/board/${boardId}/sprint?state=active`,
      { credentials: 'same-origin', headers: { Accept: 'application/json' } }
    );
    if (!resp.ok) throw new Error(`Sprint API ${resp.status}`);
    const data = await resp.json();
    return data.values || [];
  }

  // ---------------------------------------------------------------------------
  // Scrape "days left" from Jira's sprint popup dialog
  // ---------------------------------------------------------------------------

  function scrapeDaysFromPopup() {
    const dialog = document.querySelector(
      '[role="dialog"][aria-label*="active sprint" i]'
    );
    if (!dialog) return null;
    const text = dialog.textContent;
    const match = text.match(/(\d+ days? left|Ends today|Overdue)/i);
    return match ? match[0] : null;
  }

  function parseDaysNumber(daysText) {
    if (!daysText) return null;
    if (/overdue/i.test(daysText)) return -1;
    if (/ends today/i.test(daysText)) return 0;
    const m = daysText.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ---------------------------------------------------------------------------
  // DOM injection
  // ---------------------------------------------------------------------------

  function removeBanner() {
    const existing = document.getElementById(BANNER_ID);
    if (existing) existing.remove();
  }

  function buildBanner(sprint) {
    const daysText = cachedDaysText || '';
    const days = parseDaysNumber(daysText);
    const goalText = sprint.goal || 'No sprint goal set';
    const hasGoal = Boolean(sprint.goal);

    let urgencyClass = 'jsg-days-normal';
    if (days !== null) {
      if (days <= 2) urgencyClass = 'jsg-days-critical';
      else if (days <= 5) urgencyClass = 'jsg-days-warning';
    }

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'jsg-card';

    banner.innerHTML = `
      <div class="jsg-card-header">
        <span class="jsg-sprint-name">${escapeHtml(sprint.name)}</span>
        ${daysText ? `<span class="jsg-header-sep">&ndash;</span><span class="jsg-days-text ${urgencyClass}">${escapeHtml(daysText)}</span>` : ''}
      </div>
      <div class="jsg-goal-text ${hasGoal ? '' : 'jsg-no-goal'}">${escapeHtml(goalText)}</div>
    `;

    return banner;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function findInsertionPoint() {
    const header = document.querySelector(
      '[data-testid="horizontal-nav-header.ui.board-header.header"]'
    );
    if (header && header.children.length >= 2) {
      return { el: header, ref: header.lastElementChild, mode: 'before' };
    }

    const fallbacks = [
      '#ghx-content-main',
      '[data-testid="software-board.board"]',
      '[data-testid="software-board.board-container"]',
      '#jira-frontend',
      '#ak-main-content',
      'main[role="main"]',
      'main',
    ];
    for (const sel of fallbacks) {
      const el = document.querySelector(sel);
      if (el) return { el, ref: el.firstChild, mode: 'prepend' };
    }
    return null;
  }

  async function injectBanner() {
    const boardId = extractBoardId(window.location.href);
    if (!boardId) {
      removeBanner();
      return;
    }

    // Avoid redundant fetches for the same board
    if (boardId === currentBoardId && document.getElementById(BANNER_ID)) return;
    currentBoardId = boardId;

    let sprints;
    try {
      sprints = await fetchActiveSprints(boardId);
    } catch (err) {
      console.warn('[Sprint Goal] API error:', err.message);
      return;
    }

    if (!sprints.length) {
      removeBanner();
      return;
    }

    const sprint = sprints[0];
    currentSprintData = sprint;

    const stored = await chrome.storage.local.get('jsg-enabled');
    if (stored['jsg-enabled'] === false) {
      removeBanner();
      return;
    }

    if (!cachedDaysText) {
      const bdays = businessDaysRemaining(sprint.endDate);
      cachedDaysText = formatBusinessDays(bdays);
    }

    removeBanner();
    const banner = buildBanner(sprint);

    // Wait for the insertion point to appear (Jira lazy-renders)
    insertWithRetry(banner, 0);
  }

  function insertWithRetry(banner, attempt) {
    const result = findInsertionPoint();
    if (result) {
      result.el.insertBefore(banner, result.ref);
      return;
    }
    if (attempt < 20) {
      setTimeout(() => insertWithRetry(banner, attempt + 1), 500);
    }
  }

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------

  function onNavigate() {
    const newBoardId = extractBoardId(window.location.href);
    if (newBoardId !== currentBoardId) {
      currentBoardId = null;
      currentSprintData = null;
    }
    injectBanner();
  }

  function patchHistoryMethod(method) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new Event('jsg-locationchange'));
      return result;
    };
  }

  function setupNavigationListeners() {
    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('jsg-locationchange', onNavigate);

    // Listen for messages from the background service worker
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'jsg-navigation') onNavigate();
      if (msg.type === 'jsg-toggle') {
        if (msg.enabled === false) removeBanner();
        else injectBanner();
      }
    });
  }

  // Also observe DOM mutations as a safety net -- Jira re-renders aggressively
  function setupMutationObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const boardId = extractBoardId(window.location.href);
        if (boardId && !document.getElementById(BANNER_ID)) {
          injectBanner();
        }
      }, 1000);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------------
  // Watch for Jira's sprint popup to appear and scrape "days left"
  // ---------------------------------------------------------------------------

  function updateBadgeFromScraped(daysText) {
    cachedDaysText = daysText;
    const days = parseDaysNumber(daysText);
    let cls = 'jsg-days-normal';
    if (days !== null && days <= 2) cls = 'jsg-days-critical';
    else if (days !== null && days <= 5) cls = 'jsg-days-warning';

    const existing = document.querySelector('#' + BANNER_ID + ' .jsg-days-text');
    if (existing) {
      existing.textContent = daysText;
      existing.className = 'jsg-days-text ' + cls;
    } else {
      const header = document.querySelector('#' + BANNER_ID + ' .jsg-card-header');
      if (header) {
        const sep = document.createElement('span');
        sep.className = 'jsg-header-sep';
        sep.innerHTML = '&ndash;';
        const span = document.createElement('span');
        span.className = 'jsg-days-text ' + cls;
        span.textContent = daysText;
        header.appendChild(sep);
        header.appendChild(span);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Business-day calculation (matches Jira's "days left" logic)
  // ---------------------------------------------------------------------------

  function businessDaysRemaining(endDateStr) {
    if (!endDateStr) return null;
    const end = new Date(endDateStr);
    const now = new Date();
    end.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    if (end <= now) return end < now ? -1 : 0;
    let count = 0;
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    while (d < end) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  function formatBusinessDays(days) {
    if (days === null) return '';
    if (days < 0) return 'Overdue';
    if (days === 0) return 'Ends today';
    if (days === 1) return '1 day left';
    return `${days} days left`;
  }

  function setupDaysScraper() {
    const observer = new MutationObserver(() => {
      const scraped = scrapeDaysFromPopup();
      if (scraped && scraped !== cachedDaysText) {
        updateBadgeFromScraped(scraped);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const initial = scrapeDaysFromPopup();
    if (initial) {
      cachedDaysText = initial;
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  async function init() {
    setupNavigationListeners();
    setupMutationObserver();
    setupDaysScraper();

    const stored = await chrome.storage.local.get('jsg-enabled');
    if (stored['jsg-enabled'] === false) return;

    injectBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
