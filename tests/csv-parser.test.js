'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('../src/shared/csv-parser.js');

test('parses a well-formed CSV with the canonical headers', () => {
  const csv = [
    'Name,Position,Team,ProjectedPoints',
    'Christian McCaffrey,RB,SF,312.4',
    'Tyreek Hill,WR,MIA,289.1'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(errors.length, 0);
  assert.equal(players.length, 2);
  assert.deepEqual(players[0], {
    extra: {},
    name: 'Christian McCaffrey',
    position: 'RB',
    team: 'SF',
    projectedPoints: 312.4
  });
});

test('accepts aliased headers case-insensitively', () => {
  const csv = [
    'player,pos,pro team,fpts',
    'Josh Allen,QB,BUF,365.2'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(errors.length, 0);
  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'Josh Allen');
  assert.equal(players[0].position, 'QB');
  assert.equal(players[0].projectedPoints, 365.2);
});

test('handles quoted fields containing commas', () => {
  const csv = [
    'Name,Position,Team,ProjectedPoints,Notes',
    '"Smith, John",WR,DAL,120.5,"Rookie, high upside"'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(errors.length, 0);
  assert.equal(players[0].name, 'Smith, John');
  assert.equal(players[0].extra.Notes, 'Rookie, high upside');
});

test('keeps a row with a missing/non-numeric projection but records an error', () => {
  const csv = [
    'Name,Position,Team,ProjectedPoints',
    'Nick Chubb III,RB,CLE,'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(players.length, 1);
  assert.equal(players[0].projectedPoints, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /projection/i);
});

test('skips a row missing name or position and records an error', () => {
  const csv = [
    'Name,Position,Team,ProjectedPoints',
    ',RB,SF,300',
    'Valid Guy,WR,DAL,200'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(players.length, 1);
  assert.equal(players[0].name, 'Valid Guy');
  assert.equal(errors.length, 1);
});

test('reports an error and no players when required columns are missing', () => {
  const csv = [
    'FullName,Team',
    'Someone,DAL'
  ].join('\n');

  const { players, errors } = parseCsv(csv);

  assert.equal(players.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Missing required column/);
});

test('returns an error for an empty file', () => {
  const { players, errors } = parseCsv('');
  assert.equal(players.length, 0);
  assert.equal(errors.length, 1);
});

test('parses the sample fixture CSV end-to-end', () => {
  const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-projections.csv'), 'utf8');
  const { players, errors } = parseCsv(csv);

  assert.equal(players.length, 20);
  // Exactly one row (Nick Chubb III) has an intentionally blank projection.
  assert.equal(errors.length, 1);
  const chubb = players.find((p) => p.name === 'Nick Chubb III');
  assert.equal(chubb.projectedPoints, null);
});
