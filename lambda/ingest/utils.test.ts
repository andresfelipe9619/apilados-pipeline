/**
 * Unit tests for utility functions
 * Tests all data transformation and helper functions
 */

import {
  toBoolean,
  normalizeHeaders,
  toNumber,
  safeTrim,
  isNotAvailable,
  safeString,
  createCacheKey,
  validateRequiredFields,
  extractPrimitive,
  formatError,
  delay,
  calculateBackoffDelay,
} from "./utils";

describe("toBoolean", () => {
  test("converts string 'true' to true", () => {
    expect(toBoolean("true")).toBe(true);
    expect(toBoolean("TRUE")).toBe(true);
    expect(toBoolean("True")).toBe(true);
  });

  test("converts string '1' to true", () => {
    expect(toBoolean("1")).toBe(true);
  });

  test("converts string 'false' to false", () => {
    expect(toBoolean("false")).toBe(false);
    expect(toBoolean("FALSE")).toBe(false);
    expect(toBoolean("False")).toBe(false);
  });

  test("converts string '0' to false", () => {
    expect(toBoolean("0")).toBe(false);
  });

  test("converts other strings to false", () => {
    expect(toBoolean("")).toBe(false);
    expect(toBoolean("no")).toBe(false);
    expect(toBoolean("random")).toBe(false);
  });

  test("handles non-string values", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(null)).toBe(false);
    expect(toBoolean(undefined)).toBe(false);
    expect(toBoolean({})).toBe(true);
    expect(toBoolean([])).toBe(true);
  });

  test("handles whitespace in strings", () => {
    expect(toBoolean("  true  ")).toBe(true);
    expect(toBoolean("  1  ")).toBe(true);
    expect(toBoolean("  false  ")).toBe(false);
    expect(toBoolean("  0  ")).toBe(false);
  });
});

describe("normalizeHeaders", () => {
  test("normalizes basic header", () => {
    expect(normalizeHeaders({ header: "Test Header" })).toBe("test_header");
  });

  test("removes accents", () => {
    expect(normalizeHeaders({ header: "Niño Año" })).toBe("nino_ano");
    expect(normalizeHeaders({ header: "Café" })).toBe("cafe");
  });

  test("handles special characters", () => {
    expect(normalizeHeaders({ header: "Test-Header_123" })).toBe("test_header_123");
    expect(normalizeHeaders({ header: "Test@Header#123" })).toBe("test_header_123");
  });

  test("removes leading and trailing underscores", () => {
    expect(normalizeHeaders({ header: "_test_header_" })).toBe("test_header");
    expect(normalizeHeaders({ header: "___test___" })).toBe("test");
  });

  test("handles empty and whitespace", () => {
    expect(normalizeHeaders({ header: "" })).toBe("");
    expect(normalizeHeaders({ header: "   " })).toBe("");
  });

  test("handles multiple consecutive special characters", () => {
    expect(normalizeHeaders({ header: "test---header" })).toBe("test_header");
    expect(normalizeHeaders({ header: "test   header" })).toBe("test_header");
  });
});

describe("toNumber", () => {
  test("converts valid number strings", () => {
    expect(toNumber("123")).toBe(123);
    expect(toNumber("123.45")).toBe(123.45);
    expect(toNumber("-123")).toBe(-123);
    expect(toNumber("0")).toBe(0);
  });

  test("converts actual numbers", () => {
    expect(toNumber(123)).toBe(123);
    expect(toNumber(123.45)).toBe(123.45);
    expect(toNumber(-123)).toBe(-123);
  });

  test("returns null for invalid inputs", () => {
    expect(toNumber("abc")).toBe(null);
    expect(toNumber("")).toBe(null);
    expect(toNumber(null)).toBe(null);
    expect(toNumber(undefined)).toBe(null);
    expect(toNumber({})).toBe(null);
    expect(toNumber([])).toBe(null);
  });

  test("handles whitespace", () => {
    expect(toNumber("  123  ")).toBe(123);
    expect(toNumber("  ")).toBe(null);
  });
});

describe("safeTrim", () => {
  test("trims strings", () => {
    expect(safeTrim("  hello  ")).toBe("hello");
    expect(safeTrim("hello")).toBe("hello");
  });

  test("returns null for null/undefined", () => {
    expect(safeTrim(null)).toBe(null);
    expect(safeTrim(undefined)).toBe(null);
  });

  test("converts non-strings and trims", () => {
    expect(safeTrim(123)).toBe("123");
    expect(safeTrim(true)).toBe("true");
  });

  test("returns null for empty strings after trim", () => {
    expect(safeTrim("")).toBe(null);
    expect(safeTrim("   ")).toBe(null);
  });
});

describe("isNotAvailable", () => {
  test("identifies null/undefined as NA", () => {
    expect(isNotAvailable(null)).toBe(true);
    expect(isNotAvailable(undefined)).toBe(true);
  });

  test("identifies empty strings as NA", () => {
    expect(isNotAvailable("")).toBe(true);
    expect(isNotAvailable("   ")).toBe(true);
  });

  test("identifies NA patterns", () => {
    expect(isNotAvailable("NA")).toBe(true);
    expect(isNotAvailable("na")).toBe(true);
    expect(isNotAvailable("N/A")).toBe(true);
    expect(isNotAvailable("n/a")).toBe(true);
  });

  test("identifies valid values as available", () => {
    expect(isNotAvailable("hello")).toBe(false);
    expect(isNotAvailable("0")).toBe(false);
    expect(isNotAvailable(0)).toBe(false);
    expect(isNotAvailable(false)).toBe(false);
  });
});

describe("safeString", () => {
  test("converts values to strings", () => {
    expect(safeString("hello")).toBe("hello");
    expect(safeString(123)).toBe("123");
    expect(safeString(true)).toBe("true");
  });

  test("returns null for null/undefined", () => {
    expect(safeString(null)).toBe(null);
    expect(safeString(undefined)).toBe(null);
  });

  test("handles objects", () => {
    expect(safeString({})).toBe("[object Object]");
    expect(safeString([])).toBe("");
  });
});

describe("createCacheKey", () => {
  test("joins parts with default separator", () => {
    expect(createCacheKey(["a", "b", "c"])).toBe("a|b|c");
  });

  test("uses custom separator", () => {
    expect(createCacheKey(["a", "b", "c"], "-")).toBe("a-b-c");
  });

  test("filters out undefined/null parts", () => {
    expect(createCacheKey(["a", undefined, "c", null as any])).toBe("a|c");
  });

  test("handles empty array", () => {
    expect(createCacheKey([])).toBe("");
  });

  test("converts non-string parts", () => {
    expect(createCacheKey([1, 2, 3] as any)).toBe("1|2|3");
  });
});

describe("validateRequiredFields", () => {
  test("returns empty array when all fields present", () => {
    const obj = { a: 1, b: "hello", c: true };
    expect(validateRequiredFields(obj, ["a", "b", "c"])).toEqual([]);
  });

  test("identifies missing fields", () => {
    const obj = { a: 1, b: null, d: undefined };
    expect(validateRequiredFields(obj, ["a", "b", "c", "d"])).toEqual(["b", "c", "d"]);
  });

  test("handles empty object", () => {
    expect(validateRequiredFields({}, ["a", "b"])).toEqual(["a", "b"]);
  });

  test("handles empty required fields", () => {
    expect(validateRequiredFields({ a: 1 }, [])).toEqual([]);
  });
});

describe("extractPrimitive", () => {
  test("extracts existing primitive values", () => {
    const obj = { str: "hello", num: 123, bool: true };
    expect(extractPrimitive(obj, "str", "default")).toBe("hello");
    expect(extractPrimitive(obj, "num", 0)).toBe(123);
    expect(extractPrimitive(obj, "bool", false)).toBe(true);
  });

  test("returns default for missing keys", () => {
    const obj = {};
    expect(extractPrimitive(obj, "missing", "default")).toBe("default");
  });

  test("returns default for null/undefined values", () => {
    const obj = { nullVal: null, undefinedVal: undefined };
    expect(extractPrimitive(obj, "nullVal", "default")).toBe("default");
    expect(extractPrimitive(obj, "undefinedVal", "default")).toBe("default");
  });

  test("returns default for non-primitive values", () => {
    const obj = { obj: {}, arr: [] };
    expect(extractPrimitive(obj, "obj", "default")).toBe("default");
    expect(extractPrimitive(obj, "arr", "default")).toBe("default");
  });
});

describe("formatError", () => {
  test("formats Error objects", () => {
    const error = new Error("Test error");
    expect(formatError(error)).toBe("Test error");
  });

  test("formats string errors", () => {
    expect(formatError("String error")).toBe("String error");
  });

  test("formats Axios-style errors", () => {
    const axiosError = {
      response: {
        data: {
          error: {
            message: "API error"
          }
        }
      }
    };
    expect(formatError(axiosError)).toBe("API error");
  });

  test("handles unknown error types", () => {
    expect(formatError(null)).toBe("Unknown error");
    expect(formatError(undefined)).toBe("Unknown error");
    expect(formatError(123)).toBe("Unknown error");
  });

  test("adds context information", () => {
    const context = { participantId: "123", email: "test@example.com" };
    const result = formatError("Test error", context);
    expect(result).toBe("Test error (Context: participantId=123, email=test@example.com)");
  });

  test("cleans up newlines", () => {
    const error = "Error with\nnewlines\r\nand returns";
    expect(formatError(error)).toBe("Error with newlines and returns");
  });
});

describe("delay", () => {
  test("delays execution", async () => {
    const start = Date.now();
    await delay(100);
    const end = Date.now();
    expect(end - start).toBeGreaterThanOrEqual(90); // Allow some variance
  });
});

describe("calculateBackoffDelay", () => {
  test("calculates exponential backoff", () => {
    expect(calculateBackoffDelay(0, 1000)).toBe(1000);
    expect(calculateBackoffDelay(1, 1000)).toBe(2000);
    expect(calculateBackoffDelay(2, 1000)).toBe(4000);
    expect(calculateBackoffDelay(3, 1000)).toBe(8000);
  });

  test("respects maximum delay", () => {
    expect(calculateBackoffDelay(10, 1000, 5000)).toBe(5000);
  });

  test("uses default values", () => {
    expect(calculateBackoffDelay(0)).toBe(1000);
    expect(calculateBackoffDelay(1)).toBe(2000);
  });
});