import {
  FixedIntervalAvThrottle,
  NoOpAvThrottle,
} from '../../../src/v2/historical-options-corpus/services/av-throttle.service';

describe('FixedIntervalAvThrottle', () => {
  it('delays the second call when the interval has not elapsed', async () => {
    const throttle = new FixedIntervalAvThrottle(100);
    const start = Date.now();
    await throttle.wait();
    await throttle.wait();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it('does not delay when enough time has passed', async () => {
    const throttle = new FixedIntervalAvThrottle(0);
    await throttle.wait();
    const start = Date.now();
    await throttle.wait();
    expect(Date.now() - start).toBeLessThan(20);
  });
});

describe('NoOpAvThrottle', () => {
  it('resolves immediately', async () => {
    const throttle = new NoOpAvThrottle();
    const start = Date.now();
    await throttle.wait();
    expect(Date.now() - start).toBeLessThan(10);
  });
});
