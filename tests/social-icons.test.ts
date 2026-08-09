import { describe, expect, test } from "vitest";

import { resolveSocialIcon } from "../src/lib/social-icons";

describe("social icons", () => {
  test("auto-detects a known service without requesting its favicon", () => {
    const resolved = resolveSocialIcon({
      icon: "auto",
      label: "Videos",
      href: "https://youtube.com/@example",
    });

    expect(resolved.name).toBe("youtube");
    expect(resolved.icon?.path).toBeTruthy();
  });

  test("uses the generic local icon for an unknown service", () => {
    const resolved = resolveSocialIcon({
      icon: "auto",
      label: "Elsewhere",
      href: "https://social.example/@writer",
    });

    expect(resolved).toEqual({ name: "link", icon: null });
  });

  test("honors an explicit icon override", () => {
    const resolved = resolveSocialIcon({
      icon: "github",
      label: "Code",
      href: "https://example.com/profile",
    });

    expect(resolved.name).toBe("github");
    expect(resolved.icon?.path).toBeTruthy();
  });
});
