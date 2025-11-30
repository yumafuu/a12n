import { describe, expect, test } from "bun:test";
import { ROLE_COLORS, type RoleType } from "../lib/tmux.js";

describe("tmux colors", () => {
  describe("ROLE_COLORS", () => {
    test("should have all expected roles", () => {
      const roles = Object.keys(ROLE_COLORS);
      expect(roles).toContain("planner");
      expect(roles).toContain("orche");
      expect(roles).toContain("reviewer");
      expect(roles).toContain("worker");
      expect(roles.length).toBe(4);
    });

    test("each role should have required color properties", () => {
      const roles: RoleType[] = ["planner", "orche", "reviewer", "worker"];

      for (const role of roles) {
        const color = ROLE_COLORS[role];
        expect(color).toHaveProperty("fg");
        expect(color).toHaveProperty("bg");
        expect(color).toHaveProperty("border");
        expect(typeof color.fg).toBe("string");
        expect(typeof color.bg).toBe("string");
        expect(typeof color.border).toBe("string");
      }
    });

    test("all roles should have paneBgActive and paneBgInactive properties", () => {
      const roles: RoleType[] = ["planner", "orche", "reviewer", "worker"];

      for (const role of roles) {
        const color = ROLE_COLORS[role];
        expect(color).toHaveProperty("paneBgActive");
        expect(color).toHaveProperty("paneBgInactive");
        expect(typeof color.paneBgActive).toBe("string");
        expect(typeof color.paneBgInactive).toBe("string");
      }
    });

    test("worker role should have correct background colors", () => {
      const workerColor = ROLE_COLORS.worker;
      expect(workerColor.paneBgActive).toBe("colour234");
      expect(workerColor.paneBgInactive).toBe("colour237");
    });

    test("inactive pane should be grayer than active pane", () => {
      const roles: RoleType[] = ["planner", "orche", "reviewer", "worker"];

      for (const role of roles) {
        const color = ROLE_COLORS[role];
        // Extract color numbers for comparison
        const activeNum = parseInt(color.paneBgActive.replace("colour", ""));
        const inactiveNum = parseInt(color.paneBgInactive.replace("colour", ""));

        // Inactive should have higher number (lighter/grayer) than active
        expect(inactiveNum).toBeGreaterThan(activeNum);
      }
    });

    test("colors should be distinct for visual identification", () => {
      const colors = new Set([
        ROLE_COLORS.planner.border,
        ROLE_COLORS.orche.border,
        ROLE_COLORS.reviewer.border,
        ROLE_COLORS.worker.border,
      ]);
      // All border colors should be unique
      expect(colors.size).toBe(4);
    });

    test("planner color should be purple (colour54)", () => {
      expect(ROLE_COLORS.planner.bg).toBe("colour54");
      expect(ROLE_COLORS.planner.border).toBe("colour54");
    });

    test("orche color should be blue (colour24)", () => {
      expect(ROLE_COLORS.orche.bg).toBe("colour24");
      expect(ROLE_COLORS.orche.border).toBe("colour24");
    });

    test("reviewer color should be dark olive with bright yellow border", () => {
      expect(ROLE_COLORS.reviewer.bg).toBe("colour58");
      expect(ROLE_COLORS.reviewer.border).toBe("colour226");
    });

    test("worker color should be green (colour22)", () => {
      expect(ROLE_COLORS.worker.bg).toBe("colour22");
      expect(ROLE_COLORS.worker.border).toBe("colour22");
    });
  });

  describe("RoleType", () => {
    test("should accept valid role strings", () => {
      const roles: RoleType[] = ["planner", "orche", "reviewer", "worker"];
      expect(roles.length).toBe(4);
    });
  });
});
