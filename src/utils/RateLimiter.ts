import { getSpotifyRetryAfterMs } from "./spotifyRateLimit";

/**
 * Centralized rate limiter for API calls
 * Prevents runaway requests from bugs (infinite loops, re-render storms)
 */

interface RateLimiterConfig {
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  circuitBreakerThreshold: number; // Number of errors before circuit opens
  circuitBreakerResetMs: number; // Time before circuit resets
  requestTimeoutMs: number;
}

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

interface RequestRecord {
  timestamp: number;
  success: boolean;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequestsPerSecond: 20,
  maxRequestsPerMinute: 1000,
  circuitBreakerThreshold: 10,
  circuitBreakerResetMs: 30000,
  requestTimeoutMs: 10000,
};

class RateLimiter {
  private config: RateLimiterConfig;
  private requestHistory: RequestRecord[] = [];
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();
  private circuitOpen: boolean = false;
  private circuitOpenedAt: number = 0;
  private consecutiveErrors: number = 0;
  private blockedUntil = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if we're within rate limits
   */
  private checkRateLimits(): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();

    // Clean old history
    this.requestHistory = this.requestHistory.filter(
      (r) => now - r.timestamp < 60000
    );

    // Check per-second limit
    const lastSecondRequests = this.requestHistory.filter(
      (r) => now - r.timestamp < 1000
    ).length;

    if (lastSecondRequests >= this.config.maxRequestsPerSecond) {
      const oldestInWindow = this.requestHistory
        .filter((r) => now - r.timestamp < 1000)
        .sort((a, b) => a.timestamp - b.timestamp)[0];

      return {
        allowed: false,
        retryAfterMs: oldestInWindow
          ? 1000 - (now - oldestInWindow.timestamp)
          : 100,
      };
    }

    // Check per-minute limit
    if (this.requestHistory.length >= this.config.maxRequestsPerMinute) {
      const oldestRequest = this.requestHistory.sort(
        (a, b) => a.timestamp - b.timestamp
      )[0];

      return {
        allowed: false,
        retryAfterMs: oldestRequest
          ? 60000 - (now - oldestRequest.timestamp)
          : 1000,
      };
    }

    return { allowed: true };
  }

  /**
   * Check circuit breaker state
   */
  private checkCircuitBreaker(): boolean {
    if (!this.circuitOpen) return true;

    const now = Date.now();
    if (now - this.circuitOpenedAt >= this.config.circuitBreakerResetMs) {
      console.log("RateLimiter: Circuit breaker reset, allowing requests");
      this.circuitOpen = false;
      this.consecutiveErrors = 0;
      return true;
    }

    return false;
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * Record a failed request
   */
  private recordError(): void {
    this.consecutiveErrors++;

    if (this.consecutiveErrors >= this.config.circuitBreakerThreshold) {
      console.error(
        `RateLimiter: Circuit breaker opened after ${this.consecutiveErrors} consecutive errors`
      );
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
    }
  }

  /**
   * Execute a request with rate limiting and deduplication
   * @param key Unique key for deduplication (e.g., "getTrack:spotify:track:xxx")
   * @param requestFn The async function to execute
   */
  async execute<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    // Fail fast during Spotify's cooldown. Waiting queues must not release a retry storm.
    if (Date.now() < this.blockedUntil) {
      throw Object.assign(new Error("Spotify requests are paused"), { status: 429, retryAfterSeconds: (this.blockedUntil - Date.now()) / 1000 });
    }
    // Check circuit breaker
    if (!this.checkCircuitBreaker()) {
      throw new Error(
        `RateLimiter: Circuit breaker open. Retry after ${
          this.config.circuitBreakerResetMs -
          (Date.now() - this.circuitOpenedAt)
        }ms`
      );
    }

    // Check for duplicate in-flight request
    const pending = this.pendingRequests.get(key);
    if (
      pending &&
      Date.now() - pending.timestamp < this.config.requestTimeoutMs
    ) {
      return pending.promise;
    }

    // Check rate limits
    const rateLimitCheck = this.checkRateLimits();
    if (!rateLimitCheck.allowed) {
      // Wait and retry
      await this.delay(rateLimitCheck.retryAfterMs || 100);
      return this.execute(key, requestFn);
    }

    // Reserve at dispatch, so concurrent pending reads count against the limit too.
    this.requestHistory.push({ timestamp: Date.now(), success: true });
    const promise = this.executeWithTimeout(requestFn)
      .then((result) => {
        this.recordSuccess();
        this.pendingRequests.delete(key);
        return result;
      })
      .catch((error) => {
        const retryAfter = getSpotifyRetryAfterMs(error);
        if (retryAfter !== null) this.blockedUntil = Math.max(this.blockedUntil, Date.now() + retryAfter);
        this.recordError();
        this.pendingRequests.delete(key);
        throw error;
      });

    this.pendingRequests.set(key, { promise, timestamp: Date.now() });
    return promise;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(requestFn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        requestFn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Request timeout")), this.config.requestTimeoutMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current stats for debugging
   */
  getStats(): {
    requestsLastSecond: number;
    requestsLastMinute: number;
    pendingRequests: number;
    circuitOpen: boolean;
    consecutiveErrors: number;
  } {
    const now = Date.now();
    return {
      requestsLastSecond: this.requestHistory.filter(
        (r) => now - r.timestamp < 1000
      ).length,
      requestsLastMinute: this.requestHistory.filter(
        (r) => now - r.timestamp < 60000
      ).length,
      pendingRequests: this.pendingRequests.size,
      circuitOpen: this.circuitOpen,
      consecutiveErrors: this.consecutiveErrors,
    };
  }

  /**
   * Reset the rate limiter (useful for testing)
   */
  reset(): void {
    this.requestHistory = [];
    this.pendingRequests.clear();
    this.circuitOpen = false;
    this.circuitOpenedAt = 0;
    this.consecutiveErrors = 0;
    this.blockedUntil = 0;
  }
}

// Export singleton instance for GraphQL requests
export const graphqlRateLimiter = new RateLimiter({
  maxRequestsPerSecond: 15,
  maxRequestsPerMinute: 1000,
  circuitBreakerThreshold: 10,
  circuitBreakerResetMs: 30000,
});

// Export class for custom instances
export { RateLimiter };
export type { RateLimiterConfig };
