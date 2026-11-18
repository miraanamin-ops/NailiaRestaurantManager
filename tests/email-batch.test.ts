import { describe, expect, test } from "vitest";
import { backoffMs, BATCH_SIZE, chunk, isRetryable, LOOKUP_CHUNK } from "@/lib/email/batch-rules";

describe("sending campaigns in batches (review E1, E2)", () => {
  test("a big list splits into Resend's batches of 100 and lookups of 100", () => {
    const ids = Array.from({ length: 2_050 }, (_, i) => i);
    const batches = chunk(ids, BATCH_SIZE);
    expect(batches).toHaveLength(21);
    expect(batches[0]).toHaveLength(100);
    expect(batches[20]).toEqual([2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036, 2037, 2038, 2039, 2040, 2041, 2042, 2043, 2044, 2045, 2046, 2047, 2048, 2049]);
    expect(batches.flat()).toEqual(ids);
    expect(chunk(ids, LOOKUP_CHUNK).every((c) => c.length <= 100)).toBe(true);
    expect(chunk([], 100)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  test("retried: rate limits, Resend's own errors, no answer", () => {
    expect(isRetryable({ name: "rate_limit_exceeded", statusCode: 429 })).toBe(true);
    expect(isRetryable({ name: "internal_server_error", statusCode: 500 })).toBe(true);
    expect(isRetryable({ statusCode: 503 })).toBe(true);
    expect(isRetryable({ statusCode: null })).toBe(true);
  });

  test("not retried: bad requests, keys or a used-up quota", () => {
    expect(isRetryable({ name: "validation_error", statusCode: 422 })).toBe(false);
    expect(isRetryable({ name: "invalid_api_key", statusCode: 403 })).toBe(false);
    expect(isRetryable({ name: "daily_quota_exceeded", statusCode: 429 })).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });

  test("waits 1 second, then 4", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(4000);
  });
});
