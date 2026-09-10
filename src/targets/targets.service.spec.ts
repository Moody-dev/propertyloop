import { TargetsService, currentPeriod } from './targets.service';
import {
  StaffTarget,
  TargetProvenance,
  TargetUnit,
} from '../../generated/prisma/client';

function target(over: Partial<StaffTarget> = {}): StaffTarget {
  return {
    id: 't1',
    staffId: 's1',
    label: 'Verified properties listed',
    min: 20,
    max: 30,
    actual: 0,
    unit: TargetUnit.COUNT,
    ceiling: false,
    provenance: TargetProvenance.MANUAL,
    metricKey: null,
    period: '2026-09',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as StaffTarget;
}

describe('TargetsService', () => {
  const service = new TargetsService({} as any);
  // progress() is private but is the whole scoring rule, so it is exercised
  // directly rather than through a database round trip.
  const progress = (t: StaffTarget, actual: number): number =>
    (service as any).progress(t, actual);

  describe('floor targets — a number to reach', () => {
    it('scores 0 at nothing', () => {
      expect(progress(target(), 0)).toBe(0);
    });

    it('scores proportionally on the way up', () => {
      expect(progress(target({ min: 20 }), 10)).toBe(50);
    });

    it('caps at 100 rather than rewarding overshoot', () => {
      expect(progress(target({ min: 20 }), 40)).toBe(100);
    });

    it('treats a zero floor as already met', () => {
      expect(progress(target({ min: 0 }), 0)).toBe(100);
    });
  });

  describe('ceiling targets — a number to stay under', () => {
    // This is the rule that was wrong first time round: an 8% reshoot rate
    // against a 10% limit is SUCCESS, and scoring it 20% read as failure.
    it('scores 100 when under the limit', () => {
      const t = target({ ceiling: true, min: 10, max: 10 });
      expect(progress(t, 8)).toBe(100);
    });

    it('scores 100 exactly at the limit', () => {
      const t = target({ ceiling: true, min: 10, max: 10 });
      expect(progress(t, 10)).toBe(100);
    });

    it('falls away once over the limit', () => {
      const t = target({ ceiling: true, min: 10, max: 10 });
      expect(progress(t, 15)).toBe(50);
      expect(progress(t, 20)).toBe(0);
    });

    it('handles a zero ceiling — no scheduling conflicts allowed', () => {
      const t = target({ ceiling: true, min: 0, max: 0 });
      expect(progress(t, 0)).toBe(100);
      expect(progress(t, 1)).toBe(0);
    });
  });

  describe('currentPeriod', () => {
    it('is YYYY-MM', () => {
      expect(currentPeriod()).toMatch(/^\d{4}-\d{2}$/);
    });

    it('uses Lagos time, so late evening does not roll the month early', () => {
      // 31 Aug 23:30 UTC is 1 Sep 00:30 in Lagos.
      expect(currentPeriod(new Date('2026-08-31T23:30:00Z'))).toBe('2026-09');
      // 31 Aug 22:00 UTC is still 31 Aug 23:00 in Lagos.
      expect(currentPeriod(new Date('2026-08-31T22:00:00Z'))).toBe('2026-08');
    });
  });
});
