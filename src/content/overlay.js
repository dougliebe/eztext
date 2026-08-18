// overlay.js
// Builds and manages the small floating panel injected into the draft room:
// a shadow-DOM host so ESPN's page CSS can't bleed in (or out), a drag
// handle, a collapse toggle, and a render() call that fills in the top-3
// list + sync status. No draft/CSV logic lives here - content-script.js
// calls render() with plain data.

(function (root) {
  'use strict';

  var storage = root.__DraftAssistant.storage;

  function createOverlay(settings) {
    var host = document.createElement('div');
    host.id = 'espn-draft-assistant-overlay-host';
    var shadow = host.attachShadow({ mode: 'open' });

    var wrapper = document.createElement('div');
    wrapper.className = 'da-overlay';
    wrapper.innerHTML =
      '<div class="da-header" part="header">' +
        '<span class="da-status-dot" data-status="lost"></span>' +
        '<span class="da-title">Draft Assistant</span>' +
        '<button class="da-collapse-btn" type="button" aria-label="Collapse">−</button>' +
      '</div>' +
      '<div class="da-body">' +
        '<div class="da-empty">Upload your player CSV via the toolbar icon to get started.</div>' +
        '<ul class="da-list" style="display:none"></ul>' +
      '</div>' +
      '<div class="da-footer">' +
        '<span class="da-updated">not synced yet</span>' +
        '<span class="da-unmatched" style="display:none"></span>' +
      '</div>';

    shadow.appendChild(wrapper);
    document.documentElement.appendChild(host);

    // Load overlay.css into the shadow root so it's fully isolated from
    // ESPN's page styles in both directions.
    fetch(chrome.runtime.getURL('src/content/overlay.css'))
      .then(function (res) { return res.text(); })
      .then(function (css) {
        var style = document.createElement('style');
        style.textContent = css;
        shadow.insertBefore(style, wrapper);
      })
      .catch(function () {
        // If this fails the overlay still works, just unstyled - acceptable
        // degradation rather than a hard failure.
      });

    var els = {
      dot: shadow.querySelector('.da-status-dot'),
      collapseBtn: shadow.querySelector('.da-collapse-btn'),
      body: shadow.querySelector('.da-body'),
      empty: shadow.querySelector('.da-empty'),
      list: shadow.querySelector('.da-list'),
      updated: shadow.querySelector('.da-updated'),
      unmatched: shadow.querySelector('.da-unmatched'),
      header: shadow.querySelector('.da-header')
    };

    applyPosition(host, settings.overlayPosition);
    setCollapsed(els, !!settings.overlayCollapsed);

    els.collapseBtn.addEventListener('click', function () {
      var collapsed = !els.body.classList.contains('da-collapsed');
      setCollapsed(els, collapsed);
      storage.updateSettings({ overlayCollapsed: collapsed });
    });

    setupDrag(host, els.header, function (pos) {
      storage.updateSettings({ overlayPosition: pos });
    });

    var lastUpdateTs = null;

    function setCollapsed(elements, collapsed) {
      if (collapsed) {
        elements.body.classList.add('da-collapsed');
        elements.collapseBtn.textContent = '+';
        elements.collapseBtn.setAttribute('aria-label', 'Expand');
      } else {
        elements.body.classList.remove('da-collapsed');
        elements.collapseBtn.textContent = '−';
        elements.collapseBtn.setAttribute('aria-label', 'Collapse');
      }
    }

    /**
     * @param {Object} data
     * @param {'synced'|'lost'} data.status
     * @param {Array} data.topPlayers - [{ name, position, team, projectedPoints }]
     * @param {number} data.unmatchedCount
     * @param {string[]} data.unmatchedNames
     * @param {boolean} data.hasCsv
     * @param {number|null} data.pickNumber
     */
    function render(data) {
      els.dot.setAttribute('data-status', data.status === 'synced' ? 'synced' : 'lost');

      if (!data.hasCsv) {
        els.empty.style.display = '';
        els.empty.textContent = 'Upload your player CSV via the toolbar icon to get started.';
        els.list.style.display = 'none';
      } else if (data.status !== 'synced') {
        els.empty.style.display = '';
        els.empty.textContent = 'Lost sync with the draft room ⚠ retrying…';
        els.list.style.display = 'none';
      } else if (!data.topPlayers || data.topPlayers.length === 0) {
        els.empty.style.display = '';
        els.empty.textContent = 'No available players matched yet.';
        els.list.style.display = 'none';
      } else {
        els.empty.style.display = 'none';
        els.list.style.display = '';
        els.list.innerHTML = data.topPlayers.map(function (p, i) {
          var proj = typeof p.projectedPoints === 'number' ? p.projectedPoints.toFixed(1) : '—';
          var meta = [p.position, p.team].filter(Boolean).join(' · ');
          return '<li class="da-row">' +
            '<span class="da-rank">' + (i + 1) + '</span>' +
            '<span class="da-name" title="' + escapeHtml(p.rawName || p.name) + '">' + escapeHtml(p.rawName || p.name) + '</span>' +
            '<span class="da-meta">' + escapeHtml(meta) + '</span>' +
            '<span class="da-proj">' + proj + '</span>' +
          '</li>';
        }).join('');
      }

      if (data.unmatchedCount > 0) {
        els.unmatched.style.display = '';
        els.unmatched.textContent = data.unmatchedCount + ' unmatched';
        els.unmatched.title = (data.unmatchedNames || []).slice(0, 15).join(', ');
      } else {
        els.unmatched.style.display = 'none';
      }

      lastUpdateTs = data.status === 'synced' ? Date.now() : lastUpdateTs;
      updateFooterText(data.pickNumber);
    }

    function updateFooterText(pickNumber) {
      var relative = lastUpdateTs ? relativeTime(Date.now() - lastUpdateTs) : 'not synced yet';
      els.updated.textContent = pickNumber ? ('pick #' + pickNumber + ' · ' + relative) : relative;
    }

    setInterval(function () { updateFooterText(null); }, 1000);

    return { render: render, host: host };
  }

  function relativeTime(ms) {
    var seconds = Math.floor(ms / 1000);
    if (seconds < 2) return 'updated just now';
    if (seconds < 60) return 'updated ' + seconds + 's ago';
    var minutes = Math.floor(seconds / 60);
    return 'updated ' + minutes + 'm ago';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function applyPosition(host, pos) {
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      host.style.setProperty('--da-left', pos.x + 'px');
      // Positioning is actually done via inline style on the inner wrapper
      // once the shadow root exists; store desired coords on the host for
      // setupDrag to pick up as the initial position.
      host.dataset.initialX = pos.x;
      host.dataset.initialY = pos.y;
    }
  }

  function setupDrag(host, handle, onDragEnd) {
    var shadow = host.shadowRoot;
    var wrapper = shadow.querySelector('.da-overlay');

    if (host.dataset.initialX && host.dataset.initialY) {
      wrapper.style.left = host.dataset.initialX + 'px';
      wrapper.style.top = host.dataset.initialY + 'px';
      wrapper.style.right = 'auto';
    }

    var dragging = false;
    var startX, startY, startLeft, startTop;

    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      var rect = wrapper.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var newLeft = startLeft + (e.clientX - startX);
      var newTop = startTop + (e.clientY - startY);
      wrapper.style.left = newLeft + 'px';
      wrapper.style.top = newTop + 'px';
      wrapper.style.right = 'auto';
    });

    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      var rect = wrapper.getBoundingClientRect();
      onDragEnd({ x: rect.left, y: rect.top });
    });
  }

  var api = { createOverlay: createOverlay };

  root.__DraftAssistant = root.__DraftAssistant || {};
  root.__DraftAssistant.overlay = api;
})(typeof window !== 'undefined' ? window : globalThis);
