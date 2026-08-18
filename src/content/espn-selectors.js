// espn-selectors.js
//
// *** THE ONE FILE TO EDIT WHEN ESPN CHANGES THEIR DRAFT ROOM MARKUP ***
//
// Every ESPN-specific DOM selector and API URL lives here so a broken
// selector has one obvious place to fix, isolated from draft-sync.js's
// actual observing/matching logic.
//
// VERIFICATION STATUS (read this before trusting the selectors below):
// During initial development we confirmed, live, against ESPN's public Mock
// Draft Lobby (no login required):
//   - Lobby URL:        https://fantasy.espn.com/football/mockdraftlobby
//   - Waiting room URL: https://fantasy.espn.com/football/waitingroom?leagueId={id}
//   - Live draft room:  https://fantasy.espn.com/football/draft?leagueId={id}
//   - Real internal API host is lm-api-reads.fantasy.espn.com (NOT
//     fantasy.espn.com) - confirmed via a real waiting-room network request:
//       https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}
//         /segments/0/leagues/{leagueId}?view=mSettings&view=mTeam&view=modular&view=mNav
//
// We were NOT able to fully load the live draft room itself in an automated/
// anonymous browser session (ESPN's SPA routed back to the waiting room with
// an internal error when the guest-only mock draft tried to transition in).
// That means the CSS selectors below for the actual "available players"
// table are an informed best guess based on how ESPN's fantasy site is
// generally structured (BEM-ish `Table__*` class names used elsewhere on
// fantasy.espn.com), not a confirmed observation of the live draft room DOM.
//
// ACTION REQUIRED: the first time you run this against a real (or mock)
// draft room, open DevTools → Elements on the "Players Available" list and
// update SELECTORS.availablePlayers* below to match. draft-sync.js is
// written to fail loudly (overlay shows "Lost sync") rather than silently
// if none of these resolve, so a wrong guess here is safe, just inert.

(function (root) {
  'use strict';

  var SELECTORS = {
    // Container that wraps the whole "available players" table. Tried in
    // order; first one that resolves to a non-empty element wins.
    availablePlayersContainer: [
      '.playerTableOuterWrapper',
      '.Table__Scroller',
      '[class*="players-available"]',
      '[data-testid="players-available-table"]'
    ],

    // Each row of a player within the container above.
    playerRow: [
      'tr.player-row',
      'tbody tr',
      '[class*="player--row"]'
    ],

    // Within a player row, where to read the name/position/team text from.
    // Kept generic (search the row's text) with specific fallbacks, because
    // exact class names are the most likely thing to have changed by the
    // time you're reading this.
    playerNameCell: [
      '.player-column__athlete',
      '[class*="player-name"]',
      'a.playertablePlayerName'
    ],
    playerPositionCell: [
      '.playerinfo__playerpos',
      '[class*="position"]'
    ],
    playerTeamCell: [
      '.playerinfo__playerteam',
      '[class*="pro-team"]'
    ],

    // A stable-ish container to anchor the overlay's fixed position near
    // (falls back to document.body if none resolve).
    draftRoomRoot: [
      '#fitt-analytics ~ div',
      'main',
      'body'
    ]
  };

  /**
   * Tries each selector in `list` against `root` (default: document) and
   * returns the first match that resolves to at least one element, or null.
   */
  function queryFirst(list, scope) {
    scope = scope || document;
    for (var i = 0; i < list.length; i++) {
      try {
        var el = scope.querySelector(list[i]);
        if (el) return el;
      } catch (e) {
        // Invalid selector for this browser/ESPN markup revision - skip it.
      }
    }
    return null;
  }

  function queryAllFirst(list, scope) {
    scope = scope || document;
    for (var i = 0; i < list.length; i++) {
      try {
        var els = scope.querySelectorAll(list[i]);
        if (els && els.length > 0) return els;
      } catch (e) {
        // ignore
      }
    }
    return [];
  }

  /**
   * Best-effort internal API URL builder for the optional "pick number"
   * enhancement. Confirmed host + path shape; the exact `view` params needed
   * for draft-pick data (as opposed to the mSettings/mTeam/mNav shape we
   * observed) are NOT confirmed - try `mDraftDetail` first, and inspect the
   * real response shape in DevTools before relying on any field from it.
   */
  function buildDraftDetailUrl(leagueId, seasonYear) {
    return 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' +
      encodeURIComponent(seasonYear) + '/segments/0/leagues/' +
      encodeURIComponent(leagueId) + '?view=mDraftDetail';
  }

  /**
   * Pulls leagueId out of the current page URL's query string, or null.
   */
  function getLeagueIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get('leagueId');
    return id ? id : null;
  }

  var api = {
    SELECTORS: SELECTORS,
    queryFirst: queryFirst,
    queryAllFirst: queryAllFirst,
    buildDraftDetailUrl: buildDraftDetailUrl,
    getLeagueIdFromUrl: getLeagueIdFromUrl
  };

  root.__DraftAssistant = root.__DraftAssistant || {};
  root.__DraftAssistant.espnSelectors = api;
})(typeof window !== 'undefined' ? window : globalThis);
