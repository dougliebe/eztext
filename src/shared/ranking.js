// ranking.js
// Turns (all CSV players, set of drafted players) into the small "top N"
// list the overlay displays. Deliberately a single pure function per
// strategy with no DOM/storage access, so it's trivial to unit test and easy
// to extend with a smarter strategy later (VORP, positional-need weighting,
// etc.) without touching content-script.js or overlay.js.

(function (root) {
  'use strict';

  /**
   * v1 strategy: filter out drafted players, sort the rest by projected
   * points descending, return the top N. Position-agnostic by design (the
   * user picks whichever position they want from the list).
   * Players with a null/missing projection sort last rather than being
   * dropped, so a CSV with a few incomplete rows still shows something
   * reasonable instead of silently hiding players.
   */
  function rankByOverallProjection(players) {
    return players.slice().sort(function (a, b) {
      var aPts = typeof a.projectedPoints === 'number' ? a.projectedPoints : -Infinity;
      var bPts = typeof b.projectedPoints === 'number' ? b.projectedPoints : -Infinity;
      return bPts - aPts;
    });
  }

  // Registry of ranking strategies, keyed by name. Add a new function here
  // (and reference it via `settings.rankingMethod`) to introduce a new
  // ranking mode without changing any caller.
  var STRATEGIES = {
    overallProjection: rankByOverallProjection
  };

  /**
   * @param {Array} players - full CSV player list (each with an `id`)
   * @param {Set} draftedIds - set of player `id`s already off the board
   * @param {Object} [options]
   * @param {number} [options.n=3] - how many players to return
   * @param {string} [options.strategy='overallProjection']
   * @returns {Array} up to n available players, best first
   */
  function getTopAvailable(players, draftedIds, options) {
    options = options || {};
    var n = typeof options.n === 'number' ? options.n : 3;
    var strategyName = options.strategy || 'overallProjection';
    var strategyFn = STRATEGIES[strategyName] || STRATEGIES.overallProjection;

    var available = players.filter(function (p) {
      return !draftedIds.has(p.id);
    });

    return strategyFn(available).slice(0, n);
  }

  var api = {
    getTopAvailable: getTopAvailable,
    strategies: STRATEGIES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.__DraftAssistant = root.__DraftAssistant || {};
    root.__DraftAssistant.ranking = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
