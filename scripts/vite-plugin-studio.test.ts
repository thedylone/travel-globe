import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import type { Connect, ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { studio } from "./vite-plugin-studio.ts";

/** A made-up "photo": random blocks of grey, so it has edges and differs from any other seed. */
const scene = (seed: number) => {
    let x = seed;
    const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const [w, h, block] = [480, 360, 20];
    const shades = Array.from({ length: (w / block) * (h / block) }, () => Math.round(rand() * 255));
    const data = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
        for (let i = 0; i < w; i++) data[y * w + i] = shades[Math.floor(y / block) * (w / block) + Math.floor(i / block)];
    }
    return sharp(data, { raw: { width: w, height: h, channels: 1 } });
};

describe("studio API: review and photo info", () => {
    let dir: string;
    let handle: Connect.NextHandleFunction;

    /** Writes a thumbnail where the photo pipeline would, and lists it in data/photos.json. */
    const photo = async (id: string, img: ReturnType<typeof scene>, kind: "image" | "video" = "image") => {
        const file = path.join(dir, "public", "photos", "thumb", `${id}.webp`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await img.webp({ quality: 70 }).toFile(file);
        const manifest = path.join(dir, "data", "photos.json");
        const entries = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : {};
        fs.writeFileSync(manifest, JSON.stringify({ ...entries, [id]: { kind, width: 480, height: 360 } }));
    };

    const call = (method: string, url: string, body?: unknown) =>
        new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
            const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
                method,
                url,
                headers: { host: "localhost" },
            }) as unknown as IncomingMessage;
            const res = {
                statusCode: 200,
                setHeader: () => {},
                end: (text: string) => resolve({ status: res.statusCode, json: JSON.parse(text) }),
            } as unknown as ServerResponse;
            Promise.resolve(handle(req, res, () => reject(new Error("not handled")))).catch(reject);
        });
    const review = (stops: unknown) => call("POST", "/__studio/review", { stops });
    const pick = (body: unknown) => call("POST", "/__studio/pick", body);

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-"));
        fs.mkdirSync(path.join(dir, "data"));
        const server = {
            middlewares: { use: (h: Connect.NextHandleFunction) => (handle = h) },
            config: { logger: { error: () => {} } },
        } as unknown as ViteDevServer;
        (studio({ dataDir: dir }).configureServer as (s: ViteDevServer) => void)(server);
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("marks a blurry photo and a retake, keeping the sharper of the pair", async () => {
        await photo("t/a/1", scene(1));
        await photo("t/a/2", scene(1).extract({ left: 12, top: 8, width: 456, height: 344 }).blur(0.6));
        await photo("t/a/3", scene(2).blur(5));
        await photo("t/a/4", scene(3));
        const { status, json } = await review([["t/a/1", "t/a/2", "t/a/3", "t/a/4"]]);
        expect(status).toBe(200);
        expect(json.flags).toEqual({ "t/a/2": { similarTo: "t/a/1" }, "t/a/3": { blurry: true } });
    });

    it("only compares photos within the same stop", async () => {
        await photo("t/a/1", scene(1));
        await photo("t/b/1", scene(1));
        expect((await review([["t/a/1"], ["t/b/1"]])).json.flags).toEqual({});
        expect((await review([["t/a/1", "t/b/1"]])).json.flags).toEqual({ "t/b/1": { similarTo: "t/a/1" } });
    });

    it("leaves videos, and photos without a thumbnail, alone", async () => {
        await photo("t/a/1", scene(1));
        await photo("t/a/clip", scene(1), "video");
        const { json } = await review([["t/a/1", "t/a/clip", "t/a/missing"]]);
        expect(json.flags).toEqual({});
    });

    it("scores a regenerated thumbnail afresh", async () => {
        await photo("t/a/1", scene(1));
        await photo("t/a/2", scene(4));
        expect((await review([["t/a/1", "t/a/2"]])).json.flags).toEqual({});
        // The second photo is re-made as a copy of the first; a stale score would miss it.
        await new Promise((r) => setTimeout(r, 20));
        await photo("t/a/2", scene(1).blur(0.6));
        expect((await review([["t/a/1", "t/a/2"]])).json.flags).toEqual({ "t/a/2": { similarTo: "t/a/1" } });
    });

    /** An original in photos/, with the time and position a phone would write. */
    const original = async (file: string, time?: string, gps?: [number, number]) => {
        const out = path.join(dir, "photos", file);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const dms = (x: number) => `${Math.floor(Math.abs(x))}/1 ${Math.round((Math.abs(x) % 1) * 60 * 100)}/100 0/1`;
        await scene(1)
            .jpeg()
            .withExif({
                IFD0: { Make: "test" },
                ...(time ? { IFD2: { DateTimeOriginal: time } } : {}),
                ...(gps
                    ? { IFD3: { GPSLatitudeRef: gps[0] < 0 ? "S" : "N", GPSLatitude: dms(gps[0]), GPSLongitudeRef: gps[1] < 0 ? "W" : "E", GPSLongitude: dms(gps[1]) } }
                    : {}),
            })
            .toFile(out);
    };

    it("reads when and where each photo was taken from its original", async () => {
        await original("t/krakow/01-IMG_1.jpg", "2024:03:07 10:12:00", [50.06, 19.94]);
        await original("t/krakow/02-IMG_2.JPG", "2024:03:07 18:30:05");
        await original("t/krakow/03-IMG_3.jpg");
        const { status, json } = await call("POST", "/__studio/photo-info", {
            ids: ["t/krakow/01-IMG_1", "t/krakow/02-IMG_2", "t/krakow/03-IMG_3", "t/krakow/gone", "t/elsewhere/1"],
        });
        expect(status).toBe(200);
        expect(json.info).toEqual({
            "t/krakow/01-IMG_1": { time: "2024-03-07 10:12:00", at: { lat: 50.06, lng: 19.94 } },
            "t/krakow/02-IMG_2": { time: "2024-03-07 18:30:05" },
            "t/krakow/03-IMG_3": {},
        });
    });

    it("reads a replaced original again", async () => {
        await original("t/a/1.jpg", "2024:03:07 10:00:00");
        const info = async () => (await call("POST", "/__studio/photo-info", { ids: ["t/a/1"] })).json.info;
        expect(await info()).toEqual({ "t/a/1": { time: "2024-03-07 10:00:00" } });
        await new Promise((r) => setTimeout(r, 20));
        await original("t/a/1.jpg", "2024:03:09 08:00:00");
        expect(await info()).toEqual({ "t/a/1": { time: "2024-03-09 08:00:00" } });
    });

    it("refuses ids that aren't a list of photo ids", async () => {
        for (const bad of [undefined, "t/a/1", [1], ["../../etc/passwd"]]) {
            const { status } = await call("POST", "/__studio/photo-info", { ids: bad });
            expect(status).toBe(400);
        }
    });

    it("refuses stops that aren't lists of ids", async () => {
        for (const bad of [undefined, "t/a/1", [["t/a/1", 2]], [{}]]) {
            const { status, json } = await review(bad);
            expect(status).toBe(400);
            expect(json.error).toMatch(/lists of photo ids/);
        }
    });

    it("picks the best photo of each moment, skipping blurry ones and videos", async () => {
        await photo("t/a/1", scene(1));
        await photo("t/a/2", scene(1).blur(5));
        await photo("t/a/3", scene(2));
        await photo("t/a/4", scene(3));
        await photo("t/a/clip", scene(4), "video");
        const { status, json } = await pick({
            stops: [["t/a/1", "t/a/2", "t/a/3", "t/a/4", "t/a/clip"]],
            per: 2,
            moments: [[["t/a/1", "t/a/2"], ["t/a/3", "t/a/4"]]],
        });
        expect(status).toBe(200);
        const [stop] = json.stops as { picks: { id: string; runnersUp: string[] }[]; considered: number }[];
        expect(stop.considered).toBe(4);
        expect(stop.picks).toHaveLength(2);
        expect(stop.picks[0]).toEqual({ id: "t/a/1", score: expect.any(Number), runnersUp: [] });
        expect(["t/a/3", "t/a/4"]).toContain(stop.picks[1].id);
    });

    it("refuses a pick without lists of ids", async () => {
        expect((await pick({ stops: "t/a/1" })).status).toBe(400);
        expect((await pick({ stops: [["t/a/1"]], moments: ["t/a/1"] })).status).toBe(400);
    });
});
