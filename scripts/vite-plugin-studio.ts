/**
 * The studio's local API (`travel-globe studio`): lists, edits, creates and deletes trip
 * files, and imports trips from photos uploaded by the page. Only added to the dev server
 * by the studio command, as it writes to the data folder.
 *
 *   GET    /__studio/trips              every trip, with its dates and problems
 *   GET    /__studio/trips/<id>         one trip as written, plus each stop's photos
 *   PUT    /__studio/trips/<id>         replace a trip (JSON body: the trip)
 *   POST   /__studio/trips              new trip (JSON body: the trip)
 *   DELETE /__studio/trips/<id>         delete a trip and its photos (those another trip shows stay)
 *   POST   /__studio/trips/<id>/photos  add an uploaded batch to a trip (JSON: batch, km)
 *   GET    /__studio/bases              data/bases.yaml, for `from` and `to`
 *   GET    /__studio/place?q=&country=  where a place name is: data/places.json, else looked up (not saved)
 *   POST   /__studio/upload?batch=&name=   one photo for an import (body: the file; batch: any id)
 *   POST   /__studio/import             import an uploaded batch (JSON: batch, title, from, km, force)
 *   POST   /__studio/review             blurry and near-duplicate photos (JSON: stops, each a list of photo ids)
 */
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Plugin } from "vite";
import YAML from "yaml";
import type { Media } from "../src/types.ts";
import { nominatimSearch, PlaceCache } from "./lib/geocode.ts";
import { addPhotos, ImportError, importTrip } from "./lib/importer.ts";
import { loadTravelData, paths, resolvePhotos } from "./lib/load.ts";
import { type PhotoFlag, type PhotoScore, reviewStop, scorePhoto } from "./lib/review.ts";
import { BasesSchema, formatIssues, PhotoManifestSchema, type TripInput, TripSchema } from "./lib/schema.ts";
import { deleteTrip } from "./lib/remove.ts";
import { slugify, tripYaml } from "./lib/write.ts";

const PREFIX = "/__studio/";
const ID = /^[^/\\]+$/;

class HttpError extends Error {
    constructor(readonly status: number, message: string, readonly extra: object = {}) {
        super(message);
    }
}

const readBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
};
const readJson = async (req: IncomingMessage) => {
    try {
        return JSON.parse(await readBody(req));
    } catch {
        throw new HttpError(400, "body isn't JSON");
    }
};
const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
};

/** The first day of a trip as written, e.g. "2024-03-07", or undefined if no stop has a date yet. */
const firstDay = (trip: { stops?: { date?: unknown }[] }) =>
    (trip.stops ?? [])
        .flatMap((s) => (typeof s.date === "string" && /^\d{4}-\d\d-\d\d/.test(s.date) ? [s.date.slice(0, 10)] : []))
        .sort()[0];
const lastDay = (trip: { stops?: { date?: unknown }[] }) =>
    (trip.stops ?? [])
        .flatMap((s) => (typeof s.date === "string" ? [s.date.split("..").pop()!.trim()] : []))
        .filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))
        .sort()
        .pop();

export const studio = ({ dataDir }: { dataDir: string }): Plugin => {
    const p = paths(dataDir);
    const uploads = path.join(os.tmpdir(), "travel-globe-studio");
    const tripFile = (id: string) => {
        if (!ID.test(id) || id.startsWith(".")) throw new HttpError(400, `bad trip id "${id}"`);
        return path.join(p.trips, `${id}.yaml`);
    };
    const readTrip = (id: string) => {
        const file = tripFile(id);
        if (!fs.existsSync(file)) throw new HttpError(404, `no trip ${id}`);
        return YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
    };
    const batchDir = (batch: unknown) => {
        if (typeof batch !== "string" || !/^[\w-]+$/.test(batch)) throw new HttpError(400, "bad batch");
        return path.join(uploads, batch);
    };
    const manifest = () =>
        fs.existsSync(p.manifest) ? PhotoManifestSchema.parse(JSON.parse(fs.readFileSync(p.manifest, "utf8"))) : {};

    /** Scores by thumbnail, kept while the studio runs; a regenerated thumbnail is scored again. */
    const scores = new Map<string, { mtime: number; score: PhotoScore }>();
    const score = async (id: string) => {
        const file = path.join(dataDir, "public", "photos", "thumb", `${id}.webp`);
        if (!fs.existsSync(file)) return undefined;
        const mtime = fs.statSync(file).mtimeMs;
        const hit = scores.get(id);
        if (hit?.mtime === mtime) return hit.score;
        const s = await scorePhoto(file).catch(() => undefined);
        if (s) scores.set(id, { mtime, score: s });
        return s;
    };

    /** Problems for each trip file, keyed by id. Looks up new places when `online`. */
    const problems = async (online: boolean) => {
        const { errors, warnings } = await loadTravelData({ root: dataDir, geocoder: online ? nominatimSearch : false });
        const byTrip = new Map<string, { errors: string[]; warnings: string[] }>();
        const add = (kind: "errors" | "warnings", line: string) => {
            const m = line.match(/^data[/\\]trips[/\\]([^:]+)\.ya?ml: (.*)$/s);
            if (!m) return;
            const entry = byTrip.get(m[1]) ?? { errors: [], warnings: [] };
            entry[kind].push(m[2]);
            byTrip.set(m[1], entry);
        };
        errors.forEach((e) => add("errors", e));
        warnings.forEach((w) => add("warnings", w));
        return byTrip;
    };

    const tripView = async (id: string, online = false) => {
        const trip = readTrip(id);
        const photos = manifest();
        const media: Media[][] = (Array.isArray(trip.stops) ? trip.stops : []).map((s: { photos?: unknown }) => {
            const ps = s?.photos;
            const ok = typeof ps === "string" || (Array.isArray(ps) && ps.every((x) => typeof x === "string"));
            return ok ? resolvePhotos(ps as string | string[], photos).media : [];
        });
        const found = (await problems(online)).get(id) ?? { errors: [], warnings: [] };
        return { id, trip, media, ...found };
    };

    const writeTrip = (file: string, body: unknown) => {
        const r = TripSchema.safeParse(body);
        if (!r.success) throw new HttpError(400, "the trip has problems", { errors: formatIssues(r.error) });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, tripYaml(r.data satisfies TripInput));
    };

    const routes = async (req: IncomingMessage, res: ServerResponse, route: string, query: URLSearchParams) => {
        const method = req.method ?? "GET";
        const [resource, id, part] = route.split("/").map(decodeURIComponent);
        if (part !== undefined && !(resource === "trips" && part === "photos" && method === "POST")) {
            throw new HttpError(404, `no such route: ${method} ${PREFIX}${route}`);
        }

        if (resource === "trips" && !id && method === "GET") {
            const found = await problems(false);
            const files = fs.existsSync(p.trips) ? fs.readdirSync(p.trips).filter((f) => f.endsWith(".yaml")) : [];
            const trips = files.map((f) => {
                const tid = f.replace(/\.yaml$/, "");
                let trip: { title?: unknown; stops?: { date?: unknown }[] } = {};
                try {
                    trip = YAML.parse(fs.readFileSync(path.join(p.trips, f), "utf8")) ?? {};
                } catch {
                    // Reported in `errors` below.
                }
                return {
                    id: tid,
                    title: typeof trip.title === "string" ? trip.title : tid,
                    start: firstDay(trip),
                    end: lastDay(trip),
                    stops: Array.isArray(trip.stops) ? trip.stops.length : 0,
                    errors: found.get(tid)?.errors.length ?? 0,
                };
            });
            trips.sort((a, b) => (b.start ?? "9999").localeCompare(a.start ?? "9999") || a.id.localeCompare(b.id));
            return send(res, 200, { trips });
        }
        if (resource === "trips" && id && method === "GET") return send(res, 200, await tripView(id));
        if (resource === "trips" && id && method === "PUT") {
            const file = tripFile(id);
            if (!fs.existsSync(file)) throw new HttpError(404, `no trip ${id}`);
            writeTrip(file, await readJson(req));
            return send(res, 200, await tripView(id, true));
        }
        if (resource === "trips" && !id && method === "POST") {
            const body = await readJson(req);
            const day = firstDay(body) ?? new Date().toISOString().slice(0, 10);
            const newId = `${day.slice(0, 7)}-${slugify(String(body?.title ?? "trip"))}`;
            const file = tripFile(newId);
            if (fs.existsSync(file)) throw new HttpError(409, `${path.relative(dataDir, file)} already exists; pick another title`);
            writeTrip(file, body);
            return send(res, 200, await tripView(newId, true));
        }
        if (resource === "trips" && id && part === "photos") {
            if (!fs.existsSync(tripFile(id))) throw new HttpError(404, `no trip ${id}`);
            const body = await readJson(req);
            const src = batchDir(body?.batch);
            const log: string[] = [];
            try {
                const result = await addPhotos({
                    root: dataDir,
                    id,
                    src,
                    km: Number(body.km) > 0 ? Number(body.km) : 15,
                    log: (line) => log.push(line),
                });
                fs.rmSync(src, { recursive: true, force: true });
                return send(res, 200, { ...result, log, view: await tripView(id, true) });
            } catch (e) {
                if (e instanceof ImportError) throw new HttpError(400, e.message, { log });
                throw e;
            }
        }
        if (resource === "trips" && id && method === "DELETE") {
            tripFile(id);
            return send(res, 200, deleteTrip(dataDir, id));
        }
        if (resource === "bases" && method === "GET") {
            const r = fs.existsSync(p.bases) ? BasesSchema.safeParse(YAML.parse(fs.readFileSync(p.bases, "utf8")) ?? {}) : undefined;
            const bases = r?.success ? Object.entries(r.data).map(([key, b]) => ({ key, ...b })) : [];
            return send(res, 200, { bases });
        }
        if (resource === "place" && method === "GET") {
            // Looked up the same way as a build, so the studio's map shows where the globe will put it.
            const q = (query.get("q") ?? "").trim();
            const country = query.get("country")?.trim() || undefined;
            if (!q) throw new HttpError(400, "no place given");
            const cache = new PlaceCache(p.places);
            const hit = cache.get(PlaceCache.key(q, country)) ?? (country ? cache.get(PlaceCache.key(q)) : undefined);
            if (hit) return send(res, 200, { at: hit, saved: true });
            // Not written to data/places.json: that happens when a trip using it is saved.
            return send(res, 200, { at: await nominatimSearch(q, country), saved: false });
        }
        if (resource === "upload" && method === "POST") {
            const batch = query.get("batch") ?? "";
            const name = path.basename(query.get("name") ?? "");
            if (!/^[\w-]+$/.test(batch) || !name || name.startsWith(".")) throw new HttpError(400, "bad upload");
            const dir = path.join(uploads, batch);
            fs.mkdirSync(dir, { recursive: true });
            // Two files with the same name (from different folders) both get in.
            let target = path.join(dir, name);
            const { name: stem, ext } = path.parse(name);
            for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${stem}-${n}${ext}`);
            await pipeline(req, fs.createWriteStream(target));
            return send(res, 200, { ok: true });
        }
        if (resource === "import" && method === "POST") {
            const body = await readJson(req);
            const src = batchDir(body?.batch);
            const log: string[] = [];
            let imported = false;
            try {
                const result = await importTrip({
                    root: dataDir,
                    src,
                    title: typeof body.title === "string" ? body.title : undefined,
                    from: typeof body.from === "string" && body.from ? body.from : undefined,
                    km: Number(body.km) > 0 ? Number(body.km) : 15,
                    force: body.force === true,
                    log: (line) => log.push(line),
                });
                imported = true;
                return send(res, 200, { id: result.id, log });
            } catch (e) {
                if (e instanceof ImportError) throw new HttpError(400, e.message, { exists: e.exists, log });
                throw e;
            } finally {
                // A failed import keeps its upload so it can be retried with another title.
                if (imported) fs.rmSync(src, { recursive: true, force: true });
            }
        }
        if (resource === "review" && method === "POST") {
            const body = await readJson(req);
            const stops: unknown = body?.stops;
            if (!Array.isArray(stops) || !stops.every((s) => Array.isArray(s) && s.every((x) => typeof x === "string"))) {
                throw new HttpError(400, "stops should be lists of photo ids");
            }
            const photos = manifest();
            const flags: Record<string, PhotoFlag> = {};
            for (const ids of stops as string[][]) {
                // Videos are left alone: their thumbnail is only the first frame.
                const scored = [];
                for (const id of ids) {
                    if (photos[id]?.kind !== "image") continue;
                    const s = await score(id);
                    if (s) scored.push({ id, ...s });
                }
                Object.assign(flags, reviewStop(scored));
            }
            return send(res, 200, { flags });
        }
        throw new HttpError(404, `no such route: ${method} ${PREFIX}${route}`);
    };

    return {
        name: "travel-globe-studio",
        apply: "serve",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url ?? "/", "http://localhost");
                if (!url.pathname.startsWith(PREFIX)) return next();
                // Only the studio page may call this: it writes files.
                const origin = req.headers.origin;
                if (origin && new URL(origin).host !== req.headers.host) return send(res, 403, { error: "cross-origin request" });
                try {
                    await routes(req, res, url.pathname.slice(PREFIX.length).replace(/\/+$/, ""), url.searchParams);
                } catch (e) {
                    if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...e.extra });
                    server.config.logger.error(`studio: ${(e as Error).stack ?? e}`);
                    send(res, 500, { error: (e as Error).message });
                }
            });
        },
    };
};
