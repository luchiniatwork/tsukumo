/**
 * Concurrency limiter for host-side handler execution.
 * See SPEC.md §8.2.
 */

/**
 * A simple async semaphore that limits the number of concurrent
 * handler executions.
 */
export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  /**
   * Run a function with concurrency limiting.
   * Blocks if the limit is reached until a slot opens.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrency) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }
}
