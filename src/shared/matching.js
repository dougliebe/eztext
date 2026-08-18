// matching.js
// Matches players from the user's uploaded CSV against player names as
// rendered live on the ESPN draft board, so we know which CSV rows are
// still available. Runs on every draft-sync tick, so lookups are cached.
//
// Same dual-export pattern as csv-parser.js: unmodified file runs both in
// the extension and under `node --test`.

(function (root) {
  'use strict';

  var SUFFIX_TOKENS = ['jr', 'sr', 'ii', 'iii', 'iv', 'v'];

  // Maps common D/ST spellings (city, mascot, full name, abbreviation) to a
  // single canonical NFL team abbreviation. Extend as mismatches are found in
  // real CSVs - see the "N unmatched" hint in the overlay.
  var TEAM_ALIASES = {
    arizona: 'ARI', cardinals: 'ARI', ari: 'ARI',
    atlanta: 'ATL', falcons: 'ATL', atl: 'ATL',
    baltimore: 'BAL', ravens: 'BAL', bal: 'BAL',
    buffalo: 'BUF', bills: 'BUF', buf: 'BUF',
    carolina: 'CAR', panthers: 'CAR', car: 'CAR',
    chicago: 'CHI', bears: 'CHI', chi: 'CHI',
    cincinnati: 'CIN', bengals: 'CIN', cin: 'CIN',
    cleveland: 'CLE', browns: 'CLE', cle: 'CLE',
    dallas: 'DAL', cowboys: 'DAL', dal: 'DAL',
    denver: 'DEN', broncos: 'DEN', den: 'DEN',
    detroit: 'DET', lions: 'DET', det: 'DET',
    greenbay: 'GB', packers: 'GB', gb: 'GB', gnb: 'GB',
    houston: 'HOU', texans: 'HOU', hou: 'HOU',
    indianapolis: 'IND', colts: 'IND', ind: 'IND',
    jacksonville: 'JAX', jaguars: 'JAX', jax: 'JAX', jac: 'JAX',
    kansascity: 'KC', chiefs: 'KC', kc: 'KC', kan: 'KC',
    lasvegas: 'LV', raiders: 'LV', lv: 'LV', oakland: 'LV', lvr: 'LV',
    losangeleschargers: 'LAC', chargers: 'LAC', lac: 'LAC', sandiego: 'LAC',
    losangelesrams: 'LAR', rams: 'LAR', lar: 'LAR', stlouis: 'LAR',
    miami: 'MIA', dolphins: 'MIA', mia: 'MIA',
    minnesota: 'MIN', vikings: 'MIN', min: 'MIN',
    newengland: 'NE', patriots: 'NE', ne: 'NE', nwe: 'NE',
    neworleans: 'NO', saints: 'NO', no: 'NO', nor: 'NO',
    newyorkgiants: 'NYG', giants: 'NYG', nyg: 'NYG',
    newyorkjets: 'NYJ', jets: 'NYJ', nyj: 'NYJ',
    philadelphia: 'PHI', eagles: 'PHI', phi: 'PHI',
    pittsburgh: 'PIT', steelers: 'PIT', pit: 'PIT',
    sanfrancisco: 'SF', '49ers': 'SF', niners: 'SF', sf: 'SF', sfo: 'SF',
    seattle: 'SEA', seahawks: 'SEA', sea: 'SEA',
    tampabay: 'TB', buccaneers: 'TB', bucs: 'TB', tb: 'TB', tam: 'TB',
    tennessee: 'TEN', titans: 'TEN', ten: 'TEN',
    washington: 'WSH', commanders: 'WSH', wsh: 'WSH', was: 'WSH'
  };

  var DST_POSITIONS = ['DST', 'D/ST', 'DEF', 'D'];
  var DST_NAME_STOPWORDS = ['dst', 'def', 'defense', 'd', 'st'];

  function isDst(position) {
    return DST_POSITIONS.indexOf(String(position || '').toUpperCase().replace(/\s+/g, '')) !== -1;
  }

  /**
   * Normalizes a player name for matching: lowercase, strip periods, strip
   * common suffix tokens, strip remaining punctuation, collapse whitespace.
   */
  function normalizeName(name) {
    var s = String(name || '').toLowerCase();
    s = s.replace(/\./g, '');
    s = s.replace(/[-'']/g, ' ');
    s = s.replace(/[^a-z0-9\s]/g, '');
    var tokens = s.split(/\s+/).filter(Boolean);
    tokens = tokens.filter(function (t) { return SUFFIX_TOKENS.indexOf(t) === -1; });
    return tokens.join(' ').trim();
  }

  /**
   * Resolves a free-text team reference - a bare abbreviation ("SF"), a city
   * or mascot ("49ers", "San Francisco"), or a full D/ST label as rendered
   * by either ESPN or a CSV ("49ers D/ST", "San Francisco D/ST") - to a
   * canonical NFL team abbreviation, or '' if unrecognized. D/ST-ish
   * stopwords ("D/ST", "DEF", "Defense") are dropped before matching so
   * callers don't need to strip them first.
   */
  function normalizeTeam(team) {
    var cleaned = String(team || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    var tokens = cleaned.split(/\s+/).filter(Boolean)
      .filter(function (t) { return DST_NAME_STOPWORDS.indexOf(t) === -1; });

    if (tokens.length === 0) return '';

    var joined = tokens.join('');
    if (TEAM_ALIASES[joined]) return TEAM_ALIASES[joined];

    for (var i = 0; i < tokens.length; i++) {
      if (TEAM_ALIASES[tokens[i]]) return TEAM_ALIASES[tokens[i]];
    }

    return '';
  }

  /**
   * Token-overlap similarity in [0, 1]: size of the intersection of the two
   * normalized names' word sets over the size of their union (Jaccard).
   * Cheap, dependency-free, and good enough to catch things like a missing
   * middle initial or a transposed nickname without pulling in a Levenshtein
   * implementation.
   */
  function similarity(normA, normB) {
    if (!normA || !normB) return 0;
    if (normA === normB) return 1;

    var tokensA = normA.split(' ');
    var tokensB = normB.split(' ');
    var setB = {};
    tokensB.forEach(function (t) { setB[t] = true; });

    var intersection = 0;
    tokensA.forEach(function (t) { if (setB[t]) intersection++; });

    var unionSize = new Set(tokensA.concat(tokensB)).size;
    return unionSize === 0 ? 0 : intersection / unionSize;
  }

  var FUZZY_THRESHOLD = 0.6; // token-overlap ratio; tuned for short name lists, see matching.test.js

  /**
   * Builds a matcher over a CSV player list. Returns an object with a single
   * `resolve(espnName, espnPosition)` method that returns the matching CSV
   * player row, or null if nothing matched closely enough. Internally caches
   * exact-name and per-position candidate lookups so repeated calls (once per
   * ESPN-rendered row, every observer tick) stay cheap.
   */
  function createMatcher(csvPlayers) {
    // Keyed by position so two same-named players at different positions
    // (e.g. a QB and an LB both named "Josh Allen") can never cross-match -
    // every non-D/ST lookup is scoped to candidates at the same position.
    var byPosition = new Map();
    var dstByTeam = new Map();

    csvPlayers.forEach(function (p) {
      var norm = normalizeName(p.name);
      p._normalizedName = norm;

      if (isDst(p.position)) {
        var teamCode = normalizeTeam(p.team) || normalizeTeam(p.name);
        if (teamCode) dstByTeam.set(teamCode, p);
      } else {
        var posKey = String(p.position || '').toUpperCase();
        if (!byPosition.has(posKey)) byPosition.set(posKey, []);
        byPosition.get(posKey).push(p);
      }
    });

    var resolveCache = new Map();

    function resolve(espnName, espnPosition) {
      var cacheKey = espnName + '|' + espnPosition;
      if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

      var result = null;

      if (isDst(espnPosition)) {
        var teamCode = normalizeTeam(espnName);
        result = (teamCode && dstByTeam.get(teamCode)) || null;
      } else {
        var norm = normalizeName(espnName);
        var candidates = byPosition.get(String(espnPosition || '').toUpperCase()) || [];

        var exact = candidates.find(function (c) { return c._normalizedName === norm; });
        if (exact) {
          result = exact;
        } else {
          // Last-name-only tier: catches nickname/formal-name mismatches
          // (e.g. CSV "Nicholas Chubb" vs ESPN "Nick Chubb") that token-
          // overlap similarity scores too low to pass FUZZY_THRESHOLD on.
          // Only applied when exactly one same-position candidate shares
          // that surname, so it can't silently pick the wrong player when
          // two same-position guys share a last name.
          var normTokens = norm.split(' ').filter(Boolean);
          var lastName = normTokens[normTokens.length - 1];
          if (lastName) {
            var surnameMatches = candidates.filter(function (c) {
              var cTokens = c._normalizedName.split(' ').filter(Boolean);
              return cTokens[cTokens.length - 1] === lastName;
            });
            if (surnameMatches.length === 1) {
              result = surnameMatches[0];
            }
          }
        }

        if (!result) {
          var best = null;
          var bestScore = 0;
          candidates.forEach(function (c) {
            var score = similarity(norm, c._normalizedName);
            if (score > bestScore) {
              bestScore = score;
              best = c;
            }
          });
          if (best && bestScore >= FUZZY_THRESHOLD) {
            result = best;
          }
        }
      }

      resolveCache.set(cacheKey, result);
      return result;
    }

    return { resolve: resolve };
  }

  var api = {
    normalizeName: normalizeName,
    normalizeTeam: normalizeTeam,
    similarity: similarity,
    isDst: isDst,
    createMatcher: createMatcher,
    FUZZY_THRESHOLD: FUZZY_THRESHOLD
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.__DraftAssistant = root.__DraftAssistant || {};
    root.__DraftAssistant.matching = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
