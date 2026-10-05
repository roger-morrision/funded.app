import test from 'node:test';
import assert from 'node:assert/strict';
import { boostPackageBadgesMarkup } from '../boost-card-badges.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const active = (packageId, multiplier, expiresAt = '2026-10-06T12:00:00Z') => ({
  packageId, multiplier, startsAt: '2026-10-05T10:00:00Z', expiresAt,
});

test('shows each selected active pack and groups repeated purchases', () => {
  const markup = boostPackageBadgesMarkup({ packages: [active('10x', 10), active('500x', 500), active('10x', 10)] }, now);
  assert.match(markup, /⚡500x/);
  assert.match(markup, /⚡10x<small>×2<\/small>/);
  assert.doesNotMatch(markup, /510x/);
  assert.match(markup, /Active paid boost packages/);
});

test('expired, future, unknown, and mismatched packs show no badge', () => {
  assert.equal(boostPackageBadgesMarkup({ packages: [active('10x', 10, '2026-10-05T11:00:00Z')] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [active('20x', 20)] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [active('500x', 50)] }, now), '');
  assert.equal(boostPackageBadgesMarkup({ packages: [{ ...active('10x', 10), startsAt: '2026-10-05T13:00:00Z' }] }, now), '');
});

test('shows a single active pack from an older aggregate-only API', () => {
  const boost = { multiplier: 10, count: 1, expiresAt: '2026-10-06T12:00:00Z' };
  assert.match(boostPackageBadgesMarkup(boost, now), /⚡10x/);
  assert.equal(boostPackageBadgesMarkup({ ...boost, count: 2 }, now), '');
  assert.equal(boostPackageBadgesMarkup({ ...boost, expiresAt: '2026-10-05T11:00:00Z' }, now), '');
});
