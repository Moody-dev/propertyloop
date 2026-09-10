import { lagosDay } from './daily-logs.service';

/**
 * The daily log keys on the LOCAL calendar day. Getting this wrong would file
 * a 9pm Lagos entry against tomorrow whenever the host runs UTC — which is
 * exactly what Railway does.
 */
describe('lagosDay', () => {
  it('returns YYYY-MM-DD', () => {
    expect(lagosDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('keeps a late Lagos evening on the same day', () => {
    // 21:00 UTC is 22:00 in Lagos — still the 8th.
    expect(lagosDay(new Date('2026-09-08T21:00:00Z'))).toBe('2026-09-08');
  });

  it('rolls over at Lagos midnight, not UTC midnight', () => {
    // 23:30 UTC is 00:30 on the 9th in Lagos.
    expect(lagosDay(new Date('2026-09-08T23:30:00Z'))).toBe('2026-09-09');
    // 23:00 UTC is 00:00 on the 9th in Lagos — the boundary itself.
    expect(lagosDay(new Date('2026-09-08T23:00:00Z'))).toBe('2026-09-09');
    // 22:59 UTC is 23:59 on the 8th.
    expect(lagosDay(new Date('2026-09-08T22:59:00Z'))).toBe('2026-09-08');
  });

  it('handles a month boundary', () => {
    expect(lagosDay(new Date('2026-08-31T23:30:00Z'))).toBe('2026-09-01');
  });

  it('handles a year boundary', () => {
    expect(lagosDay(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });
});
