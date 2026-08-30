import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatBytes,
  formatCitationRef,
  formatDuration,
  formatEta,
  historyBucket,
} from './format';

describe('formatBytes', () => {
  it('reports whole bytes without a decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to the largest sensible unit', () => {
    expect(formatBytes(13_002_342)).toBe('12.4 MB');
    expect(formatBytes(5_046_586_573)).toBe('4.7 GB');
  });

  it('does not render a negative or zero size as NaN', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('uses milliseconds below a second, so retrieval times stay legible', () => {
    expect(formatDuration(820)).toBe('820 ms');
  });

  it('uses one decimal second up to a minute', () => {
    expect(formatDuration(6_400)).toBe('6.4 s');
    expect(formatDuration(14_800)).toBe('14.8 s');
  });

  it('drops to minutes beyond that', () => {
    expect(formatDuration(252_000)).toBe('4 min 12 s');
    expect(formatDuration(120_000)).toBe('2 min');
  });
});

describe('formatEta', () => {
  it('refuses to imply second-level precision on a long job', () => {
    expect(formatEta(168)).toBe('~3 min left');
    expect(formatEta(20)).toBe('< 1 min left');
  });
});

describe('formatCitationRef', () => {
  it('orders provenance the way an engineer verifies it: page, revision, date', () => {
    expect(
      formatCitationRef({
        page: 41,
        revision: 'rev D',
        documentDate: '2026-03-11T00:00:00.000Z',
      }),
    ).toBe('p. 41 · rev D · 2026-03-11');
  });

  it('omits parts the document does not have rather than printing placeholders', () => {
    expect(formatCitationRef({ page: null, revision: null, documentDate: null })).toBe('');
    expect(formatCitationRef({ page: 8, revision: null, documentDate: null })).toBe('p. 8');
  });
});

describe('day bucketing', () => {
  const now = new Date('2026-08-30T14:00:00.000Z');

  it('counts calendar days, not elapsed hours', () => {
    // 23:30 yesterday is one day ago even though it is 14.5 hours back.
    expect(daysBetween('2026-08-29T23:30:00.000Z', now)).toBe(1);
    expect(daysBetween('2026-08-30T01:00:00.000Z', now)).toBe(0);
  });

  it('groups into the sections the history screen renders', () => {
    expect(historyBucket('2026-08-30T09:00:00.000Z', now)).toBe('today');
    expect(historyBucket('2026-08-27T09:00:00.000Z', now)).toBe('week');
    expect(historyBucket('2026-08-10T09:00:00.000Z', now)).toBe('month');
    expect(historyBucket('2026-01-10T09:00:00.000Z', now)).toBe('older');
  });
});
