// content-script.js
// Entry point: wires storage -> matching -> ranking -> overlay -> draft-sync
// together. Kept intentionally thin - each piece it calls is independently
// testable/replaceable.

(function () {
  'use strict';

  var DA = window.__DraftAssistant;
  var storage = DA.storage;
  var matching = DA.matching;
  var ranking = DA.ranking;
  var overlay = DA.overlay;
  var draftSync = DA.draftSync;
  var selectors = DA.espnSelectors;

  async function main() {
    // Self-gate: only build the overlay if this actually looks like a draft
    // room with a players list, so an imprecise manifest match pattern (or a
    // page ESPN restructured) degrades to a harmless no-op instead of a
    // broken/empty overlay on unrelated pages.
    var containerPresent = !!selectors.queryFirst(selectors.SELECTORS.availablePlayersContainer);
    if (!containerPresent) {
      // Keep checking for a little while in case the SPA is still loading
      // the draft room in - but give up rather than polling forever if this
      // genuinely isn't a draft room.
      var found = await waitFor(function () {
        return !!selectors.queryFirst(selectors.SELECTORS.availablePlayersContainer);
      }, 15000, 500);
      if (!found) return;
    }

    var settings = await storage.getSettings();
    var csvPlayers = await withIds(await storage.getPlayers());
    var matcher = matching.createMatcher(csvPlayers);
    var ui = overlay.createOverlay(settings);

    function recompute(syncState) {
      var unmatchedNames = [];

      // Everything in the CSV that did NOT show up as "available" on ESPN's
      // own list is treated as drafted. This is why matching quality matters:
      // an unmatched-but-still-available CSV player will incorrectly look
      // "drafted" until its name is fixed - surfaced via the unmatched count.
      var availableCsvIds = new Set();
      syncState.availableEspnPlayers.forEach(function (ep) {
        var match = matcher.resolve(ep.name, ep.position);
        if (match) {
          availableCsvIds.add(match.id);
        } else {
          unmatchedNames.push(ep.name);
        }
      });

      var draftedIds = new Set();
      csvPlayers.forEach(function (p) {
        if (!availableCsvIds.has(p.id)) draftedIds.add(p.id);
      });

      var top = ranking.getTopAvailable(csvPlayers, draftedIds, {
        n: 3,
        strategy: settings.rankingMethod
      });

      ui.render({
        status: syncState.status,
        topPlayers: top,
        unmatchedCount: unmatchedNames.length,
        unmatchedNames: unmatchedNames,
        hasCsv: csvPlayers.length > 0,
        pickNumber: syncState.pickNumber
      });
    }

    // Hot-reload if the CSV is (re)uploaded while the draft room is open.
    storage.onKeyChanged(storage.KEYS.PLAYERS, async function (newPlayers) {
      csvPlayers = await withIds(newPlayers || []);
      matcher = matching.createMatcher(csvPlayers);
    });
    storage.onKeyChanged(storage.KEYS.SETTINGS, async function (newSettings) {
      settings = newSettings || settings;
    });

    draftSync.startDraftSync(recompute);
  }

  /**
   * Assigns a stable-for-this-session `id` to each CSV player (used by
   * ranking's drafted-set filtering). Recomputed each load rather than
   * persisted, since the CSV itself is the source of truth.
   */
  function withIds(players) {
    return (players || []).map(function (p, i) {
      return Object.assign({ id: matching.normalizeName(p.name) + '|' + p.position + '|' + i }, p);
    });
  }

  function waitFor(predicate, timeoutMs, intervalMs) {
    return new Promise(function (resolve) {
      var elapsed = 0;
      var timer = setInterval(function () {
        elapsed += intervalMs;
        if (predicate()) {
          clearInterval(timer);
          resolve(true);
        } else if (elapsed >= timeoutMs) {
          clearInterval(timer);
          resolve(false);
        }
      }, intervalMs);
    });
  }

  main();
})();
