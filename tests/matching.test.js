'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, normalizeTeam, isDst, createMatcher } = require('../src/shared/matching.js');

test('normalizeName strips suffixes, punctuation, and case', () => {
  assert.equal(normalizeName('Odell Beckham Jr.'), 'odell beckham');
  assert.equal(normalizeName('Patrick Mahomes II'), 'patrick mahomes');
  assert.equal(normalizeName('A.J. Brown'), 'aj brown');
  assert.equal(normalizeName("Ja'Marr Chase"), 'ja marr chase');
  assert.equal(normalizeName('  Christian   McCaffrey '), 'christian mccaffrey');
});

test('normalizeTeam resolves city, mascot, and abbreviation to the same code', () => {
  assert.equal(normalizeTeam('San Francisco'), 'SF');
  assert.equal(normalizeTeam('49ers'), 'SF');
  assert.equal(normalizeTeam('SF'), 'SF');
  assert.equal(normalizeTeam('Not A Team'), '');
});

test('isDst recognizes common D/ST position spellings', () => {
  assert.equal(isDst('D/ST'), true);
  assert.equal(isDst('DST'), true);
  assert.equal(isDst('DEF'), true);
  assert.equal(isDst('WR'), false);
});

test('createMatcher resolves an exact normalized-name match', () => {
  const players = [{ id: '1', name: 'Christian McCaffrey', position: 'RB', team: 'SF' }];
  const matcher = createMatcher(players);
  const match = matcher.resolve('Christian McCaffrey', 'RB');
  assert.equal(match.id, '1');
});

test('createMatcher matches despite suffix/punctuation differences between sides', () => {
  const players = [{ id: '1', name: 'Odell Beckham Jr.', position: 'WR', team: 'BAL' }];
  const matcher = createMatcher(players);
  // ESPN might render it without the suffix.
  const match = matcher.resolve('Odell Beckham', 'WR');
  assert.equal(match.id, '1');
});

test('createMatcher matches D/ST rows by team, not name', () => {
  const players = [{ id: '1', name: 'San Francisco', position: 'D/ST', team: 'SF' }];
  const matcher = createMatcher(players);
  const match = matcher.resolve('49ers D/ST', 'D/ST');
  assert.equal(match.id, '1');
});

test('createMatcher falls back to fuzzy matching within the same position', () => {
  const players = [
    { id: '1', name: 'Nicholas Chubb', position: 'RB', team: 'CLE' },
    { id: '2', name: 'Someone Else', position: 'RB', team: 'DAL' }
  ];
  const matcher = createMatcher(players);
  const match = matcher.resolve('Nick Chubb', 'RB');
  assert.equal(match.id, '1');
});

test('createMatcher returns null when nothing matches closely enough', () => {
  const players = [{ id: '1', name: 'Christian McCaffrey', position: 'RB', team: 'SF' }];
  const matcher = createMatcher(players);
  const match = matcher.resolve('Completely Different Player', 'RB');
  assert.equal(match, null);
});

test('createMatcher does not cross-match players at different positions', () => {
  const players = [
    { id: '1', name: 'Josh Allen', position: 'QB', team: 'BUF' },
    { id: '2', name: 'Josh Allen', position: 'LB', team: 'JAX' }
  ];
  const matcher = createMatcher(players);
  const qbMatch = matcher.resolve('Josh Allen', 'QB');
  assert.equal(qbMatch.id, '1');
});
