import { PartnerRunStatus } from '../../../src/v2/partner/constants';
import { validateDataReadyPayload } from '../../../src/v2/partner/schemas/data-ready.schema';

describe('Task #71: PartnerRunStatus.FAILED', () => {
  describe('PartnerRunStatus enum', () => {
    it('includes FAILED with value "failed"', () => {
      expect(PartnerRunStatus.FAILED).toBe('failed');
    });

    it('preserves existing values', () => {
      expect(PartnerRunStatus.PROCESSING).toBe('processing');
      expect(PartnerRunStatus.COMPLETED).toBe('completed');
      expect(PartnerRunStatus.COMPLETED_WITH_ERRORS).toBe('completed_with_errors');
    });
  });

  describe('validateDataReadyPayload', () => {
    const basePayload = {
      version: 'v1' as const,
      runId: '2026-09-09-pre-0800',
      phase: 'pre' as const,
      intervals: ['daily'],
      time: Date.now(),
      runStatus: 'failed',
    };

    it('accepts a payload with runStatus: "failed"', () => {
      const result = validateDataReadyPayload(basePayload);
      expect(result.ok).toBe(true);
      expect(result.value?.runStatus).toBe('failed');
    });

    it('still accepts a payload with runStatus: "processing"', () => {
      const result = validateDataReadyPayload({ ...basePayload, runStatus: 'processing' });
      expect(result.ok).toBe(true);
      expect(result.value?.runStatus).toBe('processing');
    });

    it('still accepts a payload with runStatus: "completed"', () => {
      const result = validateDataReadyPayload({ ...basePayload, runStatus: 'completed' });
      expect(result.ok).toBe(true);
      expect(result.value?.runStatus).toBe('completed');
    });

    it('still accepts a payload with runStatus: "completed_with_errors"', () => {
      const result = validateDataReadyPayload({ ...basePayload, runStatus: 'completed_with_errors' });
      expect(result.ok).toBe(true);
      expect(result.value?.runStatus).toBe('completed_with_errors');
    });

    it('still rejects an invalid runStatus', () => {
      const result = validateDataReadyPayload({ ...basePayload, runStatus: 'bogus' });
      expect(result.ok).toBe(false);
      expect(result.errors?.some((e) => e.includes('runStatus'))).toBe(true);
    });
  });
});
