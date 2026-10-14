import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("accepte les chemins internes", () => {
    expect(safeNext("/invite/abc_DEF-123")).toBe("/invite/abc_DEF-123");
    expect(safeNext("/app/123/contacts")).toBe("/app/123/contacts");
  });
  it("refuse les redirections externes ou piégées", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/a?x=https://evil", "", undefined, "evil.com", "/%0d%0aLocation:x ", "/a b"]) {
      expect(safeNext(bad as string | undefined)).toBe("/app");
    }
  });
});
