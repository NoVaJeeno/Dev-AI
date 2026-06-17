const MAX_RETRIES = 25;
const BASE_DELAY = 400;
const MAX_DELAY = 30000;
const REQUEST_TIMEOUT = 60000;
const CONNECT_TIMEOUT = 20000;

const FALLBACK_ENDPOINTS: Record<string, string[]> = {
  'httpbin.org': ['https://httpbin.org', 'https://postman-echo.com', 'https://eu.httpbin.org', 'https://httpbingo.org'],
  'dns.google': ['https://dns.google', 'https://cloudflare-dns.com/dns-query', 'https://1.1.1.1/dns-query', 'https://9.9.9.9:5053/dns-query', 'https://dns.quad9.net/dns-query'],
};

interface ResilientFetchOptions extends RequestInit {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  timeout?: number;
  fallbackUrls?: string[];
  onRetry?: (attempt: number, error: Error) => void;
  retryOnStatus?: number[];
}

const RETRYABLE_STATUS_CODES = [408, 425, 429, 500, 502, 503, 504, 507, 508, 509, 510, 511, 520, 521, 522, 523, 524, 525, 526, 527, 530, 598, 599];

const globalCircuitBreaker = {
  failures: 0,
  lastFailure: 0,
  isOpen: false,
  openedAt: 0,
  threshold: 100,
  windowMs: 90000,
  cooldownMs: 2500,
  halfOpenAttempts: 0,
  maxHalfOpenAttempts: 50,
  successStreak: 0,
};

function checkCircuitBreaker(): boolean {
  const now = Date.now();

  if (globalCircuitBreaker.isOpen) {
    const elapsed = now - globalCircuitBreaker.openedAt;
    const dynamicCooldown = globalCircuitBreaker.cooldownMs * Math.min(globalCircuitBreaker.halfOpenAttempts + 1, 3);
    if (elapsed > dynamicCooldown) {
      console.log('[ResilientFetch] Circuit breaker half-open, probe attempt', globalCircuitBreaker.halfOpenAttempts + 1);
      globalCircuitBreaker.isOpen = false;
      globalCircuitBreaker.halfOpenAttempts++;
      globalCircuitBreaker.failures = Math.floor(globalCircuitBreaker.threshold * 0.4);
      return false;
    }
    if (globalCircuitBreaker.halfOpenAttempts >= globalCircuitBreaker.maxHalfOpenAttempts) {
      console.log('[ResilientFetch] Max half-open attempts reached, force reset');
      globalCircuitBreaker.isOpen = false;
      globalCircuitBreaker.halfOpenAttempts = 0;
      globalCircuitBreaker.failures = 0;
      return false;
    }
    return true;
  }

  if (now - globalCircuitBreaker.lastFailure > globalCircuitBreaker.windowMs) {
    globalCircuitBreaker.failures = Math.max(0, globalCircuitBreaker.failures - 1);
  }

  return false;
}

function recordSuccess(): void {
  globalCircuitBreaker.successStreak++;
  const reduction = globalCircuitBreaker.successStreak >= 3 ? 3 : 2;
  globalCircuitBreaker.failures = Math.max(0, globalCircuitBreaker.failures - reduction);
  if (globalCircuitBreaker.successStreak >= 5) {
    globalCircuitBreaker.halfOpenAttempts = 0;
  }
  if (globalCircuitBreaker.isOpen) {
    console.log('[ResilientFetch] Circuit breaker closed after success');
    globalCircuitBreaker.isOpen = false;
    globalCircuitBreaker.halfOpenAttempts = 0;
  }
}

function recordFailure(): void {
  const now = Date.now();
  globalCircuitBreaker.failures++;
  globalCircuitBreaker.lastFailure = now;
  globalCircuitBreaker.successStreak = 0;

  if (globalCircuitBreaker.failures >= globalCircuitBreaker.threshold) {
    console.warn(`[ResilientFetch] Circuit breaker OPEN after ${globalCircuitBreaker.failures} failures`);
    globalCircuitBreaker.isOpen = true;
    globalCircuitBreaker.openedAt = now;
    globalCircuitBreaker.failures = 0;
  }
}

const inflightRequests = new Map<string, Promise<Response>>();

function getDedupeKey(url: string, method: string): string {
  return `${method}:${url}`;
}

function getDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponential = baseDelay * Math.pow(1.7, attempt);
  const jitter = Math.random() * baseDelay * 0.75;
  return Math.min(exponential + jitter, maxDelay);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const msg = error instanceof Error ? error.message.toLowerCase() : '';
  return msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('aborted') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    msg.includes('epipe') ||
    msg.includes('socket') ||
    msg.includes('dns') ||
    msg.includes('bad gateway') ||
    msg.includes('gateway') ||
    msg.includes('service unavailable') ||
    msg.includes('server error') ||
    msg.includes('unexpected') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('520') ||
    msg.includes('521') ||
    msg.includes('522') ||
    msg.includes('524');
}

function getFallbackUrls(url: string): string[] {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const fallbacks = FALLBACK_ENDPOINTS[host];
    if (!fallbacks) return [];
    return fallbacks
      .filter(base => !url.startsWith(base))
      .map(base => url.replace(`${parsed.protocol}//${parsed.host}`, base));
  } catch {
    return [];
  }
}

export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<Response> {
  if (checkCircuitBreaker()) {
    const err = new Error(`Circuit breaker open - Server überlastet. Wartezeit: ${Math.ceil((globalCircuitBreaker.cooldownMs - (Date.now() - globalCircuitBreaker.openedAt)) / 1000)}s`);
    console.warn('[ResilientFetch] Request blocked by circuit breaker:', url);
    throw err;
  }

  const {
    maxRetries = MAX_RETRIES,
    baseDelay = BASE_DELAY,
    maxDelay = MAX_DELAY,
    timeout = REQUEST_TIMEOUT,
    fallbackUrls,
    onRetry,
    retryOnStatus = RETRYABLE_STATUS_CODES,
    ...fetchOptions
  } = options;

  const method = (fetchOptions.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const dedupeKey = getDedupeKey(url, method);
    const inflight = inflightRequests.get(dedupeKey);
    if (inflight) {
      console.log('[ResilientFetch] Deduplicating GET request:', url);
      try {
        return await inflight;
      } catch {
        inflightRequests.delete(dedupeKey);
      }
    }
  }

  const fetchPromise = doResilientFetch(url, {
    maxRetries,
    baseDelay,
    maxDelay,
    timeout,
    fallbackUrls,
    onRetry,
    retryOnStatus,
    ...fetchOptions,
  });

  if (method === 'GET') {
    const dedupeKey = getDedupeKey(url, method);
    inflightRequests.set(dedupeKey, fetchPromise);
    fetchPromise.finally(() => {
      setTimeout(() => inflightRequests.delete(dedupeKey), 100);
    });
  }

  return fetchPromise;
}

async function doResilientFetch(
  url: string,
  options: ResilientFetchOptions
): Promise<Response> {
  const {
    maxRetries = MAX_RETRIES,
    baseDelay = BASE_DELAY,
    maxDelay = MAX_DELAY,
    timeout = REQUEST_TIMEOUT,
    fallbackUrls,
    onRetry,
    retryOnStatus = RETRYABLE_STATUS_CODES,
    ...fetchOptions
  } = options;

  const allUrls = [url, ...(fallbackUrls || getFallbackUrls(url))];
  let lastError: Error = new Error('All fetch attempts failed');

  for (let urlIdx = 0; urlIdx < allUrls.length; urlIdx++) {
    const currentUrl = allUrls[urlIdx];

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (checkCircuitBreaker()) {
        throw new Error('Circuit breaker opened during retry sequence');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, timeout);

      try {
        const response = await fetch(currentUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (retryOnStatus.includes(response.status)) {
          recordFailure();
          if (attempt < maxRetries) {
            const delay = getDelay(attempt, baseDelay, maxDelay);
            console.log(`[ResilientFetch] Status ${response.status} for ${currentUrl}, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`);
            onRetry?.(attempt + 1, new Error(`HTTP ${response.status}`));
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          if (urlIdx < allUrls.length - 1) {
            console.log(`[ResilientFetch] Switching to fallback URL: ${allUrls[urlIdx + 1]}`);
            break;
          }
        }

        recordSuccess();
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error instanceof Error ? error : new Error(String(error));

        if (!isRetryableError(error)) {
          throw lastError;
        }

        recordFailure();

        if (attempt < maxRetries) {
          const delay = getDelay(attempt, baseDelay, maxDelay);
          console.log(`[ResilientFetch] Error for ${currentUrl}: ${lastError.message}, retry ${attempt + 1}/${maxRetries} in ${Math.round(delay)}ms`);
          onRetry?.(attempt + 1, lastError);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (urlIdx < allUrls.length - 1) {
          console.log(`[ResilientFetch] All retries exhausted for ${currentUrl}, trying fallback: ${allUrls[urlIdx + 1]}`);
          break;
        }
      }
    }
  }

  throw lastError;
}

export function createResilientFetcher(defaultOptions: Partial<ResilientFetchOptions> = {}) {
  return (url: string, options: ResilientFetchOptions = {}) =>
    resilientFetch(url, { ...defaultOptions, ...options });
}

const connectionState = {
  isOnline: true,
  lastCheck: 0,
  consecutiveFailures: 0,
  lastSuccessfulUrl: '',
};

export async function checkConnectivity(): Promise<boolean> {
  const now = Date.now();
  if (now - connectionState.lastCheck < 3000) return connectionState.isOnline;

  connectionState.lastCheck = now;

  const endpoints = [
    'https://httpbin.org/get',
    'https://dns.google/resolve?name=example.com&type=A',
    'https://1.1.1.1/dns-query?name=example.com&type=A',
    'https://cloudflare-dns.com/dns-query?name=example.com&type=A',
    'https://dns.quad9.net/dns-query?name=example.com&type=A',
    'https://postman-echo.com/get',
  ];

  if (connectionState.lastSuccessfulUrl) {
    const idx = endpoints.indexOf(connectionState.lastSuccessfulUrl);
    if (idx > 0) {
      endpoints.splice(idx, 1);
      endpoints.unshift(connectionState.lastSuccessfulUrl);
    }
  }

  const checkEndpoint = async (endpoint: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, 6000);
      const res = await fetch(endpoint, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeoutHandle);
      return res.ok || res.status < 500;
    } catch {
      return false;
    }
  };

  const firstTwo = endpoints.slice(0, 2).map(checkEndpoint);
  const results = await Promise.allSettled(firstTwo);
  const anySuccess = results.some(r => r.status === 'fulfilled' && r.value === true);

  if (anySuccess) {
    connectionState.isOnline = true;
    connectionState.consecutiveFailures = 0;
    return true;
  }

  for (let i = 2; i < endpoints.length; i++) {
    const ok = await checkEndpoint(endpoints[i]);
    if (ok) {
      connectionState.isOnline = true;
      connectionState.consecutiveFailures = 0;
      connectionState.lastSuccessfulUrl = endpoints[i];
      return true;
    }
  }

  connectionState.consecutiveFailures++;
  connectionState.isOnline = connectionState.consecutiveFailures < 12;
  return connectionState.isOnline;
}

export function getConnectionState() {
  return { ...connectionState };
}

export function getCircuitBreakerState() {
  return {
    isOpen: globalCircuitBreaker.isOpen,
    failures: globalCircuitBreaker.failures,
    threshold: globalCircuitBreaker.threshold,
    cooldownRemaining: globalCircuitBreaker.isOpen
      ? Math.max(0, globalCircuitBreaker.cooldownMs - (Date.now() - globalCircuitBreaker.openedAt))
      : 0,
  };
}

export function resetCircuitBreaker(): void {
  globalCircuitBreaker.isOpen = false;
  globalCircuitBreaker.failures = 0;
  globalCircuitBreaker.halfOpenAttempts = 0;
  globalCircuitBreaker.successStreak = 0;
  console.log('[ResilientFetch] Circuit breaker manually reset');
}
