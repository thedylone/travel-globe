import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.join(import.meta.dirname, "cli.ts");
const tsx = path.join(import.meta.dirname, "..", "node_modules", ".bin", "tsx");

describe("travel-globe command", () => {
    it("runs the photos script rather than finding it already loaded", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-"));
        try {
            const r = spawnSync(tsx, [cli, "photos", "--data", dir], { encoding: "utf8" });
            // No photos/ folder, so the script says so and fails; it used to print nothing and succeed.
            expect(r.stderr + r.stdout).toMatch(/No photos\/ folder/);
            expect(r.status).toBe(1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
