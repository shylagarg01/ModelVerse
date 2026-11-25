/**
 * Provider Circuit Breaker and Reliability Monitor.
 * Tracks per-provider response latency, error rates, and timeouts.
 * Opens circuit when a provider repeatedly fails or times out, allowing it
 * to recover during a cooldown period without blocking search requests.
 */

export interface ProviderHealthReport {
  provider: string;
  state: "closed" | "open" | "half-open";
  consecutiveFailures: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  timedOutCalls: number;
  avgTookMs: number;
  lastFailureTime?: number;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Consecutive failures before opening
  cooldownMs?: number; // Time before probing an open provider
}

export class ProviderCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly stats = new Map<
    string,
    {
      consecutiveFailures: number;
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      timedOutCalls: number;
      totalTookMs: number;
      lastFailureTime: number;
    }
  >();

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000; // 30 seconds
  }

  canExecute(providerId: string): { allowed: boolean; reason?: string } {
    const s = this.stats.get(providerId);
    if (!s || s.consecutiveFailures < this.failureThreshold) {
      return { allowed: true };
    }

    const elapsed = Date.now() - s.lastFailureTime;
    if (elapsed >= this.cooldownMs) {
      // Half-open: allow a single test execution through
      return { allowed: true };
    }

    const remainingSec = Math.ceil((this.cooldownMs - elapsed) / 1000);
    return {
      allowed: false,
      reason: `circuit open (${s.consecutiveFailures} consecutive failures, retry in ${remainingSec}s)`,
    };
  }

  recordSuccess(providerId: string, tookMs: number, _resultCount = 0): void {
    const s = this.getOrCreate(providerId);
    s.consecutiveFailures = 0;
    s.totalCalls += 1;
    s.successfulCalls += 1;
    s.totalTookMs += tookMs;
  }

  recordFailure(providerId: string, tookMs: number, isTimeout: boolean, _error?: string): void {
    const s = this.getOrCreate(providerId);
    s.consecutiveFailures += 1;
    s.totalCalls += 1;
    s.failedCalls += 1;
    if (isTimeout) s.timedOutCalls += 1;
    s.totalTookMs += tookMs;
    s.lastFailureTime = Date.now();
  }

  getHealthReports(): ProviderHealthReport[] {
    return Array.from(this.stats.entries()).map(([provider, s]) => {
      let state: "closed" | "open" | "half-open" = "closed";
      if (s.consecutiveFailures >= this.failureThreshold) {
        state = Date.now() - s.lastFailureTime >= this.cooldownMs ? "half-open" : "open";
      }
      return {
        provider,
        state,
        consecutiveFailures: s.consecutiveFailures,
        totalCalls: s.totalCalls,
        successfulCalls: s.successfulCalls,
        failedCalls: s.failedCalls,
        timedOutCalls: s.timedOutCalls,
        avgTookMs: s.totalCalls > 0 ? Math.round(s.totalTookMs / s.totalCalls) : 0,
        lastFailureTime: s.lastFailureTime || undefined,
      };
    });
  }

  reset(): void {
    this.stats.clear();
  }

  private getOrCreate(providerId: string) {
    let s = this.stats.get(providerId);
    if (!s) {
      s = {
        consecutiveFailures: 0,
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        timedOutCalls: 0,
        totalTookMs: 0,
        lastFailureTime: 0,
      };
      this.stats.set(providerId, s);
    }
    return s;
  }
}
