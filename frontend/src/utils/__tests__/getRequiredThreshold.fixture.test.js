// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getRequiredThreshold } from '../getRequiredThreshold.js';

// Gemeinsame Fixture mit Node und PHP (test/assets/op-threshold-categories.json). Das Frontend liefert
// fuer Low-Operationen low_threshold (bei 0 die 0); die Pflicht-Signatur pruefen die Aufrufer.
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../test/assets/op-threshold-categories.json'), 'utf8'));

describe('getRequiredThreshold gegen die gemeinsame Fixture', () => {
  it.each(fixture.frontend.map((c) => [c.op, JSON.stringify(c.thresholds), c.thresholds, c.expected]))(
    '%s mit %s',
    (op, _label, thresholds, expected) => {
      expect(getRequiredThreshold(op, thresholds)).toBe(expected);
    },
  );

  it('dieselbe Kategorie wie das Backend: bei 1/2/3 liefert jede Operation die Schwelle ihrer Kategorie', () => {
    const t = { low_threshold: 1, med_threshold: 2, high_threshold: 3 };
    const byCategory = { low: 1, med: 2, high: 3 };
    for (const op of fixture.operations.filter((o) => ['setOptions', 'payment', 'changeTrust', 'bumpSequence', 'claimClaimableBalance'].includes(o.type))) {
      expect(getRequiredThreshold(op.type, t), op.type).toBe(byCategory[op.category]);
    }
  });
});
