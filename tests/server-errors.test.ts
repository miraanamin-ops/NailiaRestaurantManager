import { describe, expect, test } from "vitest";
import { serverErrorAlert } from "@/lib/server-error-rules";

describe("server errors reach the builder (review O1)", () => {
  test("a crash becomes one alert naming the route, never the address", () => {
    const a = serverErrorAlert(new Error("column x does not exist\n at foo"), { routePath: "/report/[token]", routeType: "render" });
    expect(a?.message).toMatch(/^Server error on \/report\/\[token\] \(render\): column x does not exist/);
    expect(a?.message).not.toMatch(/at foo/);
    expect(a?.key).toMatch(/^server-error:\/report\/\[token\]:/);
  });

  test("the same error gives the same key, so it alerts once per 6 hours", () => {
    const one = serverErrorAlert(new Error("boom"), { routePath: "/api/app/chat" });
    const two = serverErrorAlert(new Error("boom"), { routePath: "/api/app/chat" });
    const other = serverErrorAlert(new Error("bang"), { routePath: "/api/app/chat" });
    expect(one?.key).toBe(two?.key);
    expect(one?.key).not.toBe(other?.key);
  });

  test("notFound() and redirect() are not errors", () => {
    expect(serverErrorAlert(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }), { routePath: "/" })).toBeNull();
    expect(serverErrorAlert(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }), { routePath: "/r/[slug]" })).toBeNull();
  });

  test("a digest is passed on so the log line can be found", () => {
    expect(serverErrorAlert(Object.assign(new Error("An error occurred in the Server Components render."), { digest: "12345" }), { routePath: "/" })?.message).toMatch(/Digest: 12345/);
  });
});
