import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMetric, compatibleMetrics, formatMetricFrame, metricValueAt } from '../src/features/experience/metric-number.js';

test('parses prices, holder counts, compact values and signed changes', () => {
  for (const [text, value] of [['$1,234.56',1234.56],['1,024',1024],['≥$98.81',98.81],['−2.30%',-2.3],['+$2.5M',2500000],['$-0.12',-0.12],['0.000000313 SOL',0.000000313],['$0.0₇3415',0.00000003415]]) {
    const parsed = parseMetric(text);
    assert.equal(parsed.value, value, text);
    assert.equal(formatMetricFrame(value, parsed), text, text);
  }
});

test('never interprets unavailable states, addresses, dates, ranks or ratios as metrics', () => {
  for (const text of ['—','Unavailable','Loading…','2026-11-07','16:01:09','10 / 20','Page 1 of 3','8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk','1,23','9007199254740992','0.0₉₉₉1']) assert.equal(parseMetric(text),null,text);
});

test('interpolates increases and decreases monotonically and ends at the exact target', () => {
  for (const [from,to] of [[10,100],[100,10],[-10,10],[0.0000000313,0.0000000626]]) {
    let prior=from;
    for(let elapsed=0;elapsed<=650;elapsed+=50) {
      const current=metricValueAt(from,to,elapsed);
      assert.ok(current>=Math.min(from,to)&&current<=Math.max(from,to));
      assert.ok(to>from?current>=prior:current<=prior); prior=current;
    }
    assert.equal(metricValueAt(from,to,700),to);
  }
});

test('unit and bound changes snap while compact scale changes remain comparable', () => {
  assert.ok(compatibleMetrics(parseMetric('$990K'),parseMetric('$1.01M')));
  assert.equal(compatibleMetrics(parseMetric('1 SOL'),parseMetric('1 USD')),false);
  assert.equal(compatibleMetrics(parseMetric('≥$10'),parseMetric('$10')),false);
  assert.equal(compatibleMetrics(parseMetric('10'),parseMetric('10%')),false);
  assert.equal(formatMetricFrame(0.00000045,parseMetric('$0.0₆5462')),'$0.0₆45');
  assert.equal(formatMetricFrame(1250.75,parseMetric('1,300')),'1,251');
});

test('preserves dollar-prefixed and alphanumeric token units', () => {
  for(const text of ['414 $FUNDED','27,451.36 QW4Q0L6Z','10 TOKEN2']) {
    const parsed=parseMetric(text);
    assert.ok(parsed,text);
    assert.equal(formatMetricFrame(parsed.value,parsed),text);
  }
});
