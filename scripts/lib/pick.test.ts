import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoPer, type Candidate, lookOf, momentsByLook, type PhotoLook, pickStop, scoreOf } from "./pick.ts";

const good: PhotoLook = { brightness: 0.47, shadows: 0, highlights: 0, contrast: 0.22, colour: 0.6, layout: 0.8 };
const c = (id: string, sharpness: number, hash = 0n, look: Partial<PhotoLook> = {}, meta?: Candidate["meta"]): Candidate => ({
    id,
    sharpness,
    hash,
    look: { ...good, ...look },
    ...(meta ? { meta } : {}),
});

describe("lookOf", () => {
    let dir: string;
    const write = async (name: string, rgb: [number, number, number]) => {
        const file = path.join(dir, `${name}.webp`);
        await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).webp().toFile(file);
        return lookOf(file);
    };
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "pick-"));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("sees a dark photo as dark and a grey one as colourless", async () => {
        const dark = await write("dark", [3, 3, 3]);
        expect(dark.brightness).toBeLessThan(0.05);
        expect(dark.shadows).toBeGreaterThan(0.9);
        const grey = await write("grey", [120, 120, 120]);
        expect(grey.colour).toBeLessThan(0.05);
        const red = await write("red", [200, 30, 30]);
        expect(red.colour).toBeGreaterThan(grey.colour + 0.3);
    });
});

describe("scoreOf", () => {
    it("prefers sharp, well-exposed photos, and starred or edited ones", () => {
        const base = scoreOf(c("a", 400), 400);
        expect(scoreOf(c("b", 1600), 400)).toBeGreaterThan(base);
        expect(scoreOf(c("c", 400, 0n, { brightness: 0.1, shadows: 0.4 }), 400)).toBeLessThan(base);
        expect(scoreOf(c("d", 400, 0n, { highlights: 0.3, brightness: 0.85 }), 400)).toBeLessThan(base);
        expect(scoreOf(c("e", 400, 0n, {}, { rating: 5 }), 400)).toBeGreaterThan(base);
        expect(scoreOf(c("f", 400, 0n, {}, { edited: true }), 400)).toBeGreaterThan(base);
    });
});

describe("momentsByLook", () => {
    it("starts a new moment where a photo looks unlike the one before", () => {
        const far = 0xffffffffn;
        expect(momentsByLook([c("a", 1, 0n), c("b", 1, 0b111n), c("x", 1, far), c("y", 1, far | 1n), c("z", 1, 0n)]).map((m) => m)).toEqual([
            ["a", "b"],
            ["x", "y"],
            ["z"],
        ]);
    });
});

describe("pickStop", () => {
    it("picks the best of the best moments, at most one each, in the stop's order", () => {
        const photos = [c("a1", 300), c("a2", 900), c("b1", 500), c("c1", 200), c("c2", 250)];
        const r = pickStop(photos, { per: 2, moments: [["a1", "a2"], ["b1"], ["c1", "c2"]] });
        expect(r.picks.map((p) => p.id)).toEqual(["a2", "b1"]);
        expect(r.picks[0].runnersUp).toEqual(["a1"]);
        expect(r.considered).toBe(5);
    });

    it("picks fewer when there are fewer moments", () => {
        const r = pickStop([c("a", 500), c("b", 600)], { per: 5, moments: [["a", "b"]] });
        expect(r.picks.map((p) => p.id)).toEqual(["b"]);
    });

    it("leaves out flagged photos, and treats photos in no moment as their own", () => {
        const r = pickStop([c("a", 900), c("b", 500), c("loose", 400)], { per: 5, moments: [["a", "b"]], flags: { a: { blurry: true } } });
        expect(r.picks.map((p) => p.id)).toEqual(["b", "loose"]);
        expect(r.picks[0].runnersUp).toEqual([]);
    });

    it("offers a repeat as a runner-up, but doesn't pick it", () => {
        const r = pickStop([c("a", 900), c("b", 500)], { per: 5, moments: [["a", "b"]], flags: { a: { similarTo: "b" } } });
        expect(r.picks).toEqual([{ id: "b", score: expect.any(Number), runnersUp: ["a"] }]);
    });

    it("tells moments apart by look when it isn't given any", () => {
        const far = 0xffffffffn;
        const r = pickStop([c("a", 300, 0n), c("b", 800, 1n), c("x", 500, far)], { per: 5 });
        expect(r.picks.map((p) => p.id)).toEqual(["b", "x"]);
    });

    it("handles an empty stop", () => {
        expect(pickStop([], { per: 3 })).toEqual({ picks: [], scores: {}, considered: 0 });
    });
});

describe("autoPer", () => {
    it("picks a few, more for a bigger stop, never more than it has", () => {
        expect(autoPer(2)).toBe(2);
        expect(autoPer(10)).toBe(3);
        expect(autoPer(100)).toBe(10);
        expect(autoPer(900)).toBe(12);
    });
});
