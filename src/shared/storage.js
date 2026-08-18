// storage.js
// Small typed wrapper around chrome.storage.local so both the popup and the
// content script read/write the same shape without duplicating key names.
// Not unit-tested under Node (it's a thin wrapper over a browser-only API);
// csv-parser/matching/ranking carry the offline test coverage instead.

(function (root) {
  'use strict';

  var KEYS = {
    PLAYERS: 'players',
    CSV_META: 'csvMeta',
    SETTINGS: 'settings'
  };

  var DEFAULT_SETTINGS = {
    rankingMethod: 'overallProjection',
    overlayPosition: null, // null = use default CSS position until first drag
    overlayCollapsed: false
  };

  function get(keys) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.get(keys, function (result) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result);
        }
      });
    });
  }

  function set(items) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set(items, function () {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async function getPlayers() {
    var result = await get([KEYS.PLAYERS]);
    return result[KEYS.PLAYERS] || [];
  }

  async function setPlayers(players) {
    await set([KEYS.PLAYERS].reduce(function (acc, key) {
      acc[key] = players;
      return acc;
    }, {}));
  }

  async function getCsvMeta() {
    var result = await get([KEYS.CSV_META]);
    return result[KEYS.CSV_META] || null;
  }

  async function setCsvMeta(meta) {
    var payload = {};
    payload[KEYS.CSV_META] = meta;
    await set(payload);
  }

  async function getSettings() {
    var result = await get([KEYS.SETTINGS]);
    return Object.assign({}, DEFAULT_SETTINGS, result[KEYS.SETTINGS] || {});
  }

  async function updateSettings(partial) {
    var current = await getSettings();
    var next = Object.assign({}, current, partial);
    var payload = {};
    payload[KEYS.SETTINGS] = next;
    await set(payload);
    return next;
  }

  /**
   * Subscribes to changes on the given storage key. Returns an unsubscribe
   * function. Used by the content script to hot-reload the player list if
   * the CSV is re-uploaded while a draft is open.
   */
  function onKeyChanged(key, callback) {
    function listener(changes, areaName) {
      if (areaName !== 'local' || !changes[key]) return;
      callback(changes[key].newValue, changes[key].oldValue);
    }
    chrome.storage.onChanged.addListener(listener);
    return function unsubscribe() {
      chrome.storage.onChanged.removeListener(listener);
    };
  }

  var api = {
    KEYS: KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    getPlayers: getPlayers,
    setPlayers: setPlayers,
    getCsvMeta: getCsvMeta,
    setCsvMeta: setCsvMeta,
    getSettings: getSettings,
    updateSettings: updateSettings,
    onKeyChanged: onKeyChanged
  };

  root.__DraftAssistant = root.__DraftAssistant || {};
  root.__DraftAssistant.storage = api;
})(typeof window !== 'undefined' ? window : globalThis);
