// csv-parser.js
// Parses a CSV file's raw text into an array of plain player objects.
// No build step: this file works unmodified both in the browser (extension)
// and under Node's test runner (tests/csv-parser.test.js).
//
// Expected-ish CSV columns (header names are matched loosely, see HEADER_ALIASES
// below) - a typical input looks like:
//   Name,Position,Team,ProjectedPoints
//   Christian McCaffrey,RB,SF,312.4
//   San Francisco,D/ST,SF,145.0
//
// Extra columns the CSV happens to have are preserved on each row's `extra`
// object so nothing is silently dropped, even though only name/position/team/
// projectedPoints are used by matching.js and ranking.js today.

(function (root) {
  'use strict';

  // Header name -> canonical field. Matching is case-insensitive and ignores
  // whitespace/punctuation, so "Proj. Pts", "proj_pts", and "ProjPts" all hit
  // the same alias.
  var HEADER_ALIASES = {
    name: 'name',
    player: 'name',
    playername: 'name',
    fullname: 'name',

    pos: 'position',
    position: 'position',

    team: 'team',
    proteam: 'team',
    nflteam: 'team',

    proj: 'projectedPoints',
    projpts: 'projectedPoints',
    projectedpoints: 'projectedPoints',
    projection: 'projectedPoints',
    fpts: 'projectedPoints',
    points: 'projectedPoints',
    fantasypoints: 'projectedPoints'
  };

  var REQUIRED_FIELDS = ['name', 'position'];

  /**
   * Normalizes a raw header cell into a lookup key for HEADER_ALIASES:
   * lowercase, strip everything but letters/digits.
   */
  function headerKey(raw) {
    return String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Splits one CSV line into fields, honoring double-quoted fields that may
   * contain commas or escaped ("") double quotes. Does not handle embedded
   * newlines inside quoted fields (parseCsv splits on lines first) - fine for
   * the flat player-projection CSVs this tool targets.
   */
  function splitCsvLine(line) {
    var fields = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i++) {
      var ch = line[i];

      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);

    return fields.map(function (f) { return f.trim(); });
  }

  /**
   * Splits raw CSV text into logical lines, respecting quoted newlines just
   * enough to not break on the common case (none) while staying simple.
   */
  function splitCsvLines(text) {
    return String(text)
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(function (line) { return line.trim().length > 0; });
  }

  /**
   * Parses raw CSV text into { players, errors }.
   *   players: array of { name, position, team, projectedPoints, extra }
   *   errors: array of { line, message } for rows that couldn't be used
   *
   * Never throws on malformed data - a bad row is recorded in `errors` and
   * skipped, so one bad line doesn't block the whole upload.
   */
  function parseCsv(text) {
    var lines = splitCsvLines(text);
    var result = { players: [], errors: [] };

    if (lines.length === 0) {
      result.errors.push({ line: 0, message: 'File is empty.' });
      return result;
    }

    var headerCells = splitCsvLine(lines[0]);
    var fieldForColumn = headerCells.map(function (cell) {
      var key = headerKey(cell);
      return HEADER_ALIASES[key] || null; // null = unrecognized column, kept in `extra`
    });

    var recognizedFields = fieldForColumn.filter(Boolean);
    var missingRequired = REQUIRED_FIELDS.filter(function (f) {
      return recognizedFields.indexOf(f) === -1;
    });
    if (missingRequired.length > 0) {
      result.errors.push({
        line: 1,
        message: 'Missing required column(s): ' + missingRequired.join(', ') +
          '. Recognized headers: ' + headerCells.join(', ')
      });
      return result;
    }

    for (var i = 1; i < lines.length; i++) {
      var lineNumber = i + 1; // 1-indexed, matches what a user sees in a spreadsheet
      var cells = splitCsvLine(lines[i]);

      if (cells.length === 1 && cells[0] === '') {
        continue;
      }

      var row = { extra: {} };
      for (var c = 0; c < headerCells.length; c++) {
        var field = fieldForColumn[c];
        var value = cells[c] !== undefined ? cells[c] : '';
        if (field) {
          row[field] = value;
        } else if (headerCells[c]) {
          row.extra[headerCells[c]] = value;
        }
      }

      if (!row.name || !row.position) {
        result.errors.push({ line: lineNumber, message: 'Missing name or position, row skipped.' });
        continue;
      }

      row.position = String(row.position).toUpperCase().trim();
      row.team = row.team ? String(row.team).toUpperCase().trim() : '';

      var numericProjection = parseFloat(row.projectedPoints);
      row.projectedPoints = isNaN(numericProjection) ? null : numericProjection;
      if (row.projectedPoints === null) {
        result.errors.push({ line: lineNumber, message: 'Non-numeric or missing projection for "' + row.name + '", row kept but will rank last.' });
      }

      result.players.push(row);
    }

    return result;
  }

  var api = { parseCsv: parseCsv, HEADER_ALIASES: HEADER_ALIASES };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.__DraftAssistant = root.__DraftAssistant || {};
    root.__DraftAssistant.csvParser = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
