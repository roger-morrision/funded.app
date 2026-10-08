import test from 'node:test';
import assert from 'node:assert/strict';
import { boostPackageBadgesMarkup } from '../boost-card-badges.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const active = (packageId, multiplier, expiresAt = '2026-10-06T12:00:00Z') => ({
  packageId, multiplier, startsAt: '2026-10-05T10:00:00Z', expiresAt,
});

test('shows one total for repeated and mixed active packs', () => {
  assert.match(boostPackageBadgesMarkup({ packages: [active('10x', 10), active('10x', 10)] }, now), /⚡20x<\/span>/);
  const markup = boostPackageBadgesMarkup({ packages: [active('10x', 10), active('500x', 500), active('10x', 10)] }, now);
  assert.match(markup, /⚡520x<\/span>/);
  assert.doesNotMatch(markup, /×|<small>|⚡10x|⚡500x/);
  assert.match(markup, /Active boost: 520x/);
  assert.match(boostPackageBadgesMarkup({ packages: [active('10x', 10, '2026-10-05T11:00:00Z'), active('500x', 500)] }, now), /⚡500x<\/span>/);
});

test('expired, future, unknown, and mismatched packs show no badge', () => {
  assert.equal(boostPackageBadgesMarkup({ packages: [active('10x', 10, '2026-10-05T11:00:00Z')] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [active('20x', 20)] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [active('500x', 50)] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [{ ...active('10x', 10), startsAt: '2026-10-05T13:00:00Z' }] }, now), '');
});

test('uses the verified aggregate total without multiplying its payment count', () => {
  const boost = { multiplier: 10, count: 1, expiresAt: '2026-10-06T12:00:00Z' };
  assert.match(boostPackageBadgesMarkup(boost, now), /⚡10x/);
  assert.match(boostPackageBadgesMarkup({ ...boost, multiplier: 20, count: 2 }, now), /⚡20x<\/span>/);
  assert.equal(boostPackageBadgesMarkup({ ...boost, nextExpiry: '2026-10-05T11:00:00Z' }, now), '');
  assert.equal(boostPackageBadgesMarkup({ ...boost, expiresAt: '2026-10-05T11:00:00Z' }, now), '');
});
