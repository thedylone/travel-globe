import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp, { type Sharp } from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BLURRY, distance, type PhotoScore, reviewStop, scorePhoto } from "./review.ts";

/** A made-up "photo": random blocks of colour, so it has edges and differs from any other seed. */
const scene = (seed: number, w = 640, h = 480) => {
    let x = seed;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const block = 20;
    const colours = Array.from({ length: Math.ceil(w / block) * Math.ceil(h / block) }, () => [rand(), rand(), rand()].map((c) => c * 255));
    const data = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
        for (let i = 0; i < w; i++) {
            const c = colours[Math.floor(y / block) * Math.ceil(w / block) + Math.floor(i / block)];
            data.set(c, (y * w + i) * 3);
        }
    }
    return sharp(data, { raw: { width: w, height: h, channels: 3 } });
};

describe("scorePhoto", () => {
    let dir: string;
    const write = async (name: string, img: Sharp) => {
        const file = path.join(dir, `${name}.webp`);
        await img.webp({ quality: 70 }).toFile(file);
        return scorePhoto(file);
    };
    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "review-"));
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("scores a blurred photo as much softer", async () => {
        const sharpOne = await write("a", scene(1));
        const blurred = await write("b", scene(1).blur(4));
        expect(sharpOne.sharpness).toBeGreaterThan(BLURRY * 5);
        expect(blurred.sharpness).toBeLessThan(BLURRY);
    });

    it("hashes a slightly shifted retake close to the original, and another view far from it", async () => {
        const a = await write("a", scene(2));
        const shifted = await write("b", scene(2).extract({ left: 16, top: 10, width: 610, height: 460 }));
        const other = await write("c", scene(3));
        expect(distance(a.hash, shifted.hash)).toBeLessThanOrEqual(10);
        expect(distance(a.hash, other.hash)).toBeGreaterThan(16);
    });

    it("sees a rewritten file rather than a cached one", async () => {
        const first = await write("same", scene(4));
        const second = await write("same", scene(5));
        expect(second.hash).not.toBe(first.hash);
    });
});

describe("reviewStop", () => {
    const p = (id: string, sharpness: number, hash: bigint): { id: string } & PhotoScore => ({ id, sharpness, hash });

    it("flags blurry photos, absolutely and against the rest of the stop", () => {
        const flags = reviewStop([p("a", 900, 0n), p("b", 20, 0xffffn << 16n), p("c", 60, 0xffffn << 32n), p("d", 1000, 0xffffn << 48n)]);
        expect(flags).toEqual({ b: { blurry: true }, c: { blurry: true } });
    });

    it("keeps the sharpest of a run of burst frames", () => {
        const flags = reviewStop([p("a", 500, 0b1111n), p("b", 800, 0b0111n), p("c", 600, 0b0011n), p("d", 700, 0xffffn << 32n)]);
        expect(flags).toEqual({ a: { similarTo: "b" }, c: { similarTo: "b" } });
    });

    it("only matches loosely when the photos are next to each other", () => {
        const twelveBits = 0xfffn;
        expect(reviewStop([p("a", 500, 0n), p("b", 600, twelveBits)])).toEqual({ a: { similarTo: "b" } });
        // Apart, twelve bits is too many.
        expect(reviewStop([p("a", 500, 0n), p("x", 600, 0xffffn << 40n), p("b", 600, twelveBits)])).toEqual({});
    });

    it("doesn't judge a small stop against itself", () => {
        // Softer than the others, but with only three photos that could just be the subject.
        expect(reviewStop([p("a", 1000, 0n), p("b", 100, 0xffffn << 16n), p("c", 1200, 0xffffn << 32n)])).toEqual({});
    });

    it("handles an empty stop", () => {
        expect(reviewStop([])).toEqual({});
    });
});
