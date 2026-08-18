// popup.js
// The only place the CSV gets uploaded/managed, deliberately separate from
// the live overlay (see plan: CSV upload is a rare, pre-draft action).

(function () {
  'use strict';

  var csvParser = window.__DraftAssistant.csvParser;
  var matching = window.__DraftAssistant.matching;
  var storage = window.__DraftAssistant.storage;

  var els = {
    currentCsv: document.getElementById('current-csv'),
    csvFilename: document.getElementById('csv-filename'),
    csvMeta: document.getElementById('csv-meta'),
    clearBtn: document.getElementById('clear-btn'),
    input: document.getElementById('csv-input'),
    uploadText: document.getElementById('upload-text'),
    status: document.getElementById('status')
  };

  function setStatus(message, kind) {
    els.status.textContent = message || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function withIds(players) {
    return players.map(function (p, i) {
      return Object.assign({ id: matching.normalizeName(p.name) + '|' + p.position + '|' + i }, p);
    });
  }

  async function refreshCurrentCsvCard() {
    var meta = await storage.getCsvMeta();
    if (!meta) {
      els.currentCsv.style.display = 'none';
      return;
    }
    els.currentCsv.style.display = '';
    els.csvFilename.textContent = meta.fileName;
    var uploadedAt = new Date(meta.uploadedAt).toLocaleString();
    els.csvMeta.textContent = meta.rowCount + ' players loaded' +
      (meta.errorCount ? ', ' + meta.errorCount + ' rows skipped' : '') +
      ' · ' + uploadedAt;
  }

  els.input.addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    els.uploadText.textContent = 'Parsing…';
    setStatus('');

    try {
      var text = await file.text();
      var parsed = csvParser.parseCsv(text);

      if (parsed.players.length === 0) {
        setStatus('No usable rows found. ' + (parsed.errors[0] ? parsed.errors[0].message : ''), 'error');
        els.uploadText.textContent = 'Choose CSV file…';
        return;
      }

      var players = withIds(parsed.players);
      await storage.setPlayers(players);
      await storage.setCsvMeta({
        fileName: file.name,
        uploadedAt: Date.now(),
        rowCount: players.length,
        errorCount: parsed.errors.length
      });

      var msg = players.length + ' players loaded.';
      if (parsed.errors.length > 0) {
        msg += ' ' + parsed.errors.length + ' row(s) skipped or incomplete.';
      }
      setStatus(msg, 'success');
      await refreshCurrentCsvCard();
    } catch (err) {
      setStatus('Could not read that file: ' + err.message, 'error');
    } finally {
      els.uploadText.textContent = 'Choose CSV file…';
      els.input.value = '';
    }
  });

  els.clearBtn.addEventListener('click', async function () {
    await storage.setPlayers([]);
    await storage.setCsvMeta(null);
    setStatus('Cleared.', 'success');
    await refreshCurrentCsvCard();
  });

  refreshCurrentCsvCard();
})();
