import { describe, expect, it } from 'vitest';
import { classifySyncHashes } from '../src/sync-classifier';

describe('classifySyncHashes', () => {
  it('marks identical content as synced and establishes the baseline', () => {
    expect(classifySyncHashes('A', 'A', undefined)).toEqual({ status: 'synced', baseline: 'A' });
  });

  it('detects local-only changes', () => {
    expect(classifySyncHashes('LOCAL', 'BASE', 'BASE')).toEqual({ status: 'local-changed', baseline: 'BASE' });
  });

  it('detects remote-only changes', () => {
    expect(classifySyncHashes('BASE', 'REMOTE', 'BASE')).toEqual({ status: 'remote-changed', baseline: 'BASE' });
  });

  it('detects two-sided conflicts', () => {
    expect(classifySyncHashes('LOCAL', 'REMOTE', 'BASE')).toEqual({ status: 'conflict', baseline: 'BASE' });
  });

  it('requires caution when no baseline exists', () => {
    expect(classifySyncHashes('LOCAL', 'REMOTE', undefined)).toEqual({ status: 'different', baseline: undefined });
  });
});
