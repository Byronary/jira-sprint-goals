(function () {
  'use strict';

  const BANNER_ID = 'jsg-sprint-goal-banner';
  const BANNER_SEL = '#' + BANNER_ID;
  let currentBoardId = null;
  let currentSprintData = null;
  let cachedDaysText = null;
  let injectQueue = Promise.resolve();
  let navigateDebounceTimer = null;

  // ---------------------------------------------------------------------------
  // URL parsing
  // ---------------------------------------------------------------------------

  function extractBoardId(url) {
    const newNav = url.match(/\/jira\/software\/(?:c\/)?projects\/[^/]+\/boards\/(\d+)/);
    if (newNav) return newNav[1];

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
    if (!resp.ok) {
      const err = new Error(`Sprint API ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
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

  function removeAllBanners() {
    document.querySelectorAll(BANNER_SEL).forEach((n) => n.remove());
  }

  /** Keeps the first banner node; removes duplicate ids (invalid DOM from race conditions). */
  function dedupeBanners() {
    const nodes = document.querySelectorAll(BANNER_SEL);
    for (let i = 1; i < nodes.length; i++) nodes[i].remove();
    return nodes[0] || null;
  }

  function removeBanner() {
    removeAllBanners();
  }

  function bannerInnerHtml(sprint) {
    const daysText = cachedDaysText || '';
    const days = parseDaysNumber(daysText);
    const goalText = sprint.goal || 'No sprint goal set';
    const hasGoal = Boolean(sprint.goal);

    let urgencyClass = 'jsg-days-normal';
    if (days !== null) {
      if (days <= 2) urgencyClass = 'jsg-days-critical';
      else if (days <= 5) urgencyClass = 'jsg-days-warning';
    }

    return `
      <div class="jsg-card-header">
        <span class="jsg-sprint-name">${escapeHtml(sprint.name)}</span>
        ${daysText ? `<span class="jsg-header-sep">&ndash;</span><span class="jsg-days-text ${urgencyClass}">${escapeHtml(daysText)}</span>` : ''}
      </div>
      <div class="jsg-goal-text ${hasGoal ? '' : 'jsg-no-goal'}">${escapeHtml(goalText)}</div>
    `;
  }

  function buildBanner(sprint) {
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'jsg-card';
    banner.innerHTML = bannerInnerHtml(sprint);
    return banner;
  }

  function fillBannerElement(banner, sprint) {
    banner.id = BANNER_ID;
    banner.className = 'jsg-card';
    banner.innerHTML = bannerInnerHtml(sprint);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function findBoardRoot() {
    return (
      document.querySelector('[data-testid="software-board.board"]') ||
      document.querySelector('[data-testid="software-board.board-container"]') ||
      document.querySelector('#jira-frontend') ||
      document.querySelector('#ak-main-content') ||
      null
    );
  }

  /**
   * Prefer board header rows (insert before last toolbar child).
   * Fall back to prepending inside board shell / main.
   */
  function findInsertionPoint() {
    const root = findBoardRoot();

    const tryHeaderEl = (header) => {
      if (!header) return null;
      if (header.children.length >= 2) {
        return { el: header, ref: header.lastElementChild };
      }
      if (header.children.length === 1) {
        return { el: header, ref: header.lastElementChild };
      }
      return null;
    };

    const legacy = document.querySelector(
      '[data-testid="horizontal-nav-header.ui.board-header.header"]'
    );
    const legacyHit = tryHeaderEl(legacy);
    if (legacyHit) return legacyHit;

    const exactHeaderTestIds = [
      '[data-testid^="horizontal-nav-header.ui.board-header"]',
      '[data-testid*="board-header.header"]',
    ];

    const searchScopes = [];
    if (root) searchScopes.push(root);
    searchScopes.push(document.body);

    for (const scope of searchScopes) {
      for (const sel of exactHeaderTestIds) {
        let el = null;
        try {
          el = scope.querySelector(sel);
        } catch (e) {
          continue;
        }
        const hit = tryHeaderEl(el);
        if (hit) return hit;
      }
    }

    if (root) {
      const broad = root.querySelectorAll('[data-testid*="board-header" i]');
      for (const el of broad) {
        const hit = tryHeaderEl(el);
        if (hit) return hit;
      }
    }

    const horizontalInRoot = root
      ? root.querySelector('[data-testid^="horizontal-nav-header"]')
      : null;
    const horizontalHit = tryHeaderEl(horizontalInRoot);
    if (horizontalHit) return horizontalHit;

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

  function tryInsertBanner(banner, boardIdAtStart) {
    if (extractBoardId(window.location.href) !== boardIdAtStart) {
      removeAllBanners();
      return 'abort';
    }
    const result = findInsertionPoint();
    if (result) {
      result.el.insertBefore(banner, result.ref);
      return 'done';
    }
    return 'retry';
  }

  function runInsertAttempts(banner, boardIdAtStart) {
    let status = tryInsertBanner(banner, boardIdAtStart);
    if (status !== 'retry') return;

    const deadline = Date.now() + 20000;
    let debounceTimer = null;

    const pump = () => {
      status = tryInsertBanner(banner, boardIdAtStart);
      return status;
    };

    const observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (Date.now() > deadline) {
          observer.disconnect();
          return;
        }
        if (pump() !== 'retry') observer.disconnect();
      }, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const poll = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(poll);
        observer.disconnect();
        return;
      }
      if (pump() !== 'retry') {
        clearInterval(poll);
        observer.disconnect();
      }
    }, 400);
  }

  async function injectBannerImpl() {
    dedupeBanners();

    const boardId = extractBoardId(window.location.href);
    if (!boardId) {
      removeAllBanners();
      currentBoardId = null;
      return;
    }

    const startedBoard = boardId;

    let sprints;
    try {
      sprints = await fetchActiveSprints(boardId);
    } catch (err) {
      if (err.status !== 401) {
        console.warn('[Sprint Goal] API error:', err.message);
      }
      return;
    }

    if (extractBoardId(window.location.href) !== startedBoard) return;

    if (!sprints.length) {
      removeAllBanners();
      return;
    }

    const sprint = sprints[0];
    currentSprintData = sprint;

    const stored = await chrome.storage.local.get('jsg-enabled');
    if (extractBoardId(window.location.href) !== startedBoard) return;

    if (stored['jsg-enabled'] === false) {
      removeAllBanners();
      return;
    }

    if (!cachedDaysText) {
      const bdays = businessDaysRemaining(sprint.endDate);
      cachedDaysText = formatBusinessDays(bdays);
    }

    dedupeBanners();
    let banner = document.querySelector(BANNER_SEL);
    if (banner) {
      fillBannerElement(banner, sprint);
    } else {
      banner = buildBanner(sprint);
    }

    currentBoardId = boardId;
    runInsertAttempts(banner, startedBoard);
  }

  function injectBanner() {
    injectQueue = injectQueue
      .then(() => injectBannerImpl())
      .catch((err) => {
        if (err && err.status === 401) return;
        console.warn('[Sprint Goal]', err && err.message ? err.message : err);
      });
  }

  // ---------------------------------------------------------------------------
  // SPA navigation detection
  // ---------------------------------------------------------------------------

  function onNavigateImmediate() {
    const newBoardId = extractBoardId(window.location.href);
    if (newBoardId !== currentBoardId) {
      currentBoardId = null;
      currentSprintData = null;
    }
    injectBanner();
  }

  function onNavigate() {
    if (navigateDebounceTimer) clearTimeout(navigateDebounceTimer);
    navigateDebounceTimer = setTimeout(() => {
      navigateDebounceTimer = null;
      onNavigateImmediate();
    }, 250);
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

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'jsg-navigation') onNavigate();
      if (msg.type === 'jsg-toggle') {
        if (msg.enabled === false) removeBanner();
        else injectBanner();
      }
    });
  }

  function setupMutationObserver() {
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const boardId = extractBoardId(window.location.href);
        const count = document.querySelectorAll(BANNER_SEL).length;
        if (boardId && count === 0) injectBanner();
        else if (boardId && count > 1) dedupeBanners();
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

    const root = document.querySelector(BANNER_SEL);
    if (!root) return;

    const existing = root.querySelector('.jsg-days-text');
    if (existing) {
      existing.textContent = daysText;
      existing.className = 'jsg-days-text ' + cls;
    } else {
      const header = root.querySelector('.jsg-card-header');
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
