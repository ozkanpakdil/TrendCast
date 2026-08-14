/**
 * Simple token-bucket rate limiter for API calls.
 *
 * ⚠️ Pitfall: In MV3, the service worker is ephemeral. In-memory rate
 *    limit state is lost when the worker is killed. For strict rate
 *    limiting, persist the bucket state to chrome.storage. For our
 *    use case (polling every 5 min), in-memory is acceptable because
 *    we won't exceed limits within a single worker lifecycle.
 */

interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private config: RateLimitConfig) {
    this.tokens = config.requests;
    this.lastRefill = Date.now();
  }

  /** Refill tokens based on elapsed time. */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillAmount = (elapsed / this.config.windowMs) * this.config.requests;

    this.tokens = Math.min(this.config.requests, this.tokens + refillAmount);
    this.lastRefill = now;
  }

  /** Returns true if a request can be made, false otherwise. */
  canRequest(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Wait until a token is available. */
  async waitForToken(): Promise<void> {
    while (!this.canRequest()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}