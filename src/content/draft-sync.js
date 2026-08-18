// draft-sync.js
// Watches the ESPN draft room DOM and turns it into a simple event stream:
//   onUpdate(state) -> { status: 'synced'|'lost', availableEspnPlayers, pickNumber, lastSyncedAt }
// `availableEspnPlayers` is [{ name, position, team }] read straight off the
// page - matching.js resolves these against the uploaded CSV elsewhere.
//
// Deliberately has zero knowledge of the CSV, matching, ranking, or the
// overlay - this file's only job is "what does ESPN's own DOM currently say
// is available", plus a best-effort pick number from ESPN's internal API.

(function (root) {
  'use strict';

  var selectors = root.__DraftAssistant.espnSelectors;

  var DEBOUNCE_MS = 300;
  var WATCHDOG_INTERVAL_MS = 5000;
  var STALE_AFTER_MS = 8000; // no observer tick in this long -> assume lost

  function readAvailablePlayers(container) {
    var rows = selectors.queryAllFirst(selectors.SELECTORS.playerRow, container);
    var players = [];

    rows.forEach(function (row) {
      var nameEl = selectors.queryFirst(selectors.SELECTORS.playerNameCell, row);
      if (!nameEl) return; // row didn't look like a player row, skip rather than guess

      var name = nameEl.textContent.trim();
      if (!name) return;

      var posEl = selectors.queryFirst(selectors.SELECTORS.playerPositionCell, row);
      var teamEl = selectors.queryFirst(selectors.SELECTORS.playerTeamCell, row);

      players.push({
        name: name,
        position: posEl ? posEl.textContent.trim() : '',
        team: teamEl ? teamEl.textContent.trim() : ''
      });
    });

    return players;
  }

  /**
   * @param {Function} onUpdate - called with the latest state on every
   *   successful read and whenever sync status flips.
   * @returns {{ stop: Function }}
   */
  function startDraftSync(onUpdate) {
    var state = {
      status: 'lost',
      availableEspnPlayers: [],
      pickNumber: null,
      lastSyncedAt: null
    };

    var debounceTimer = null;
    var observer = null;
    var watchdogTimer = null;
    var stopped = false;

    function emit() {
      onUpdate(Object.assign({}, state));
    }

    function attemptRead() {
      var container = selectors.queryFirst(selectors.SELECTORS.availablePlayersContainer);
      if (!container) {
        if (state.status !== 'lost') {
          state.status = 'lost';
          emit();
        }
        maybeReattachObserver();
        return;
      }

      var players = readAvailablePlayers(container);
      state.availableEspnPlayers = players;
      state.lastSyncedAt = Date.now();

      var wasLost = state.status !== 'synced';
      state.status = 'synced';
      emit();

      if (wasLost) {
        // Container just (re)appeared - make sure the observer is watching it,
        // not a stale detached node from a previous SPA view-switch.
        attachObserver(container);
      }
    }

    function scheduleRead() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(attemptRead, DEBOUNCE_MS);
    }

    function attachObserver(container) {
      if (observer) observer.disconnect();
      observer = new MutationObserver(scheduleRead);
      observer.observe(container, { childList: true, subtree: true, characterData: true });
    }

    function maybeReattachObserver() {
      // Container is currently missing (e.g. user tabbed away within the
      // draft room's own UI). Nothing to observe until the watchdog finds it
      // again via attemptRead().
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }

    function watchdogTick() {
      var staleForMs = state.lastSyncedAt ? Date.now() - state.lastSyncedAt : Infinity;
      if (state.status === 'synced' && staleForMs > STALE_AFTER_MS) {
        state.status = 'lost';
        emit();
      }
      // Always re-attempt a read - this is what recovers sync automatically
      // once the container reappears, no page reload needed.
      attemptRead();
    }

    // Initial attempt right away, then fall back to the watchdog interval.
    attemptRead();
    watchdogTimer = setInterval(watchdogTick, WATCHDOG_INTERVAL_MS);

    // Best-effort pick-number enhancement. Never blocks or degrades the
    // primary DOM-based sync above; see espn-selectors.js buildDraftDetailUrl
    // for the verification caveat on this endpoint's response shape.
    tryFetchPickNumber();
    var pickNumberTimer = setInterval(tryFetchPickNumber, 15000);

    function tryFetchPickNumber() {
      var leagueId = selectors.getLeagueIdFromUrl();
      if (!leagueId) return;

      var seasonYear = new Date().getFullYear();
      var url = selectors.buildDraftDetailUrl(leagueId, seasonYear);

      fetch(url, { credentials: 'include' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (json) {
          if (!json) return;
          var picks = json && json.draftDetail && json.draftDetail.picks;
          if (Array.isArray(picks) && picks.length > 0) {
            state.pickNumber = picks.length;
            emit();
          }
        })
        .catch(function () {
          // Silently ignored by design - this is a "nice to have" label,
          // not something the overlay's core function depends on.
        });
    }

    return {
      stop: function () {
        stopped = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        if (watchdogTimer) clearInterval(watchdogTimer);
        if (pickNumberTimer) clearInterval(pickNumberTimer);
        if (observer) observer.disconnect();
      }
    };
  }

  var api = { startDraftSync: startDraftSync };

  root.__DraftAssistant = root.__DraftAssistant || {};
  root.__DraftAssistant.draftSync = api;
})(typeof window !== 'undefined' ? window : globalThis);
