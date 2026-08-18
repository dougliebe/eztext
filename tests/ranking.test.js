'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getTopAvailable } = require('../src/shared/ranking.js');

const players = [
  { id: '1', name: 'A', projectedPoints: 300 },
  { id: '2', name: 'B', projectedPoints: 280 },
  { id: '3', name: 'C', projectedPoints: 260 },
  { id: '4', name: 'D', projectedPoints: 240 },
  { id: '5', name: 'E', projectedPoints: null }
];

test('returns the top N available players sorted by projection descending', () => {
  const top = getTopAvailable(players, new Set(), { n: 3 });
  assert.deepEqual(top.map((p) => p.id), ['1', '2', '3']);
});

test('excludes drafted players from consideration', () => {
  const top = getTopAvailable(players, new Set(['1', '2']), { n: 3 });
  assert.deepEqual(top.map((p) => p.id), ['3', '4', '5']);
});

test('defaults to top 3 when n is not specified', () => {
  const top = getTopAvailable(players, new Set());
  assert.equal(top.length, 3);
});

test('players with a null/missing projection sort last, not dropped', () => {
  const top = getTopAvailable(players, new Set(['1', '2', '3', '4']), { n: 3 });
  assert.deepEqual(top.map((p) => p.id), ['5']);
});

test('returns fewer than N when fewer players are available', () => {
  const small = [{ id: '1', name: 'Only', projectedPoints: 100 }];
  const top = getTopAvailable(small, new Set(), { n: 3 });
  assert.equal(top.length, 1);
});

test('ties keep a stable relative order', () => {
  const tied = [
    { id: '1', name: 'A', projectedPoints: 200 },
    { id: '2', name: 'B', projectedPoints: 200 }
  ];
  const top = getTopAvailable(tied, new Set(), { n: 2 });
  assert.deepEqual(top.map((p) => p.id), ['1', '2']);
});

test('unknown strategy name falls back to overallProjection instead of throwing', () => {
  const top = getTopAvailable(players, new Set(), { n: 1, strategy: 'doesNotExist' });
  assert.equal(top[0].id, '1');
});
