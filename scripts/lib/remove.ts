/**
 * Deletes a trip along with its photos: the originals in photos/, the web versions in
 * public/photos/ and their entries in data/photos.json. Photos another trip also shows are kept.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { paths, resolvePhotos } from "./load.ts";
import { type PhotoManifest, PhotoManifestSchema } from "./schema.ts";
import { manifestJson } from "./write.ts";

/** The photo ids a trip file's stops show. */
const photoIds = (trip: unknown, manifest: PhotoManifest) => {
    const stops = (trip as { stops?: unknown })?.stops;
    return (Array.isArray(stops) ? stops : []).flatMap((s: { photos?: unknown }) => {
        const ps = s?.photos;
        const ok = typeof ps === "string" || (Array.isArray(ps) && ps.every((x) => typeof x === "string"));
        return ok ? resolvePhotos(ps as string | string[], manifest).media.map((m) => m.id) : [];
    });
};

/** The folder under photos/ a photo is in, e.g. "iceland" for "iceland/reykjavik/01-a". */
const topOf = (id: string) => (id.includes("/") ? id.split("/")[0] : undefined);

/** Removes `dir` if empty, then its parents while they're empty, stopping at `top`. */
const pruneUp = (dir: string, top: string) => {
    while (dir.startsWith(top + path.sep) && fs.existsSync(dir) && !fs.readdirSync(dir).length) {
        fs.rmdirSync(dir);
        dir = path.dirname(dir);
    }
};

export const deleteTrip = (root: string, id: string): { removed: number; kept: number } => {
    const p = paths(root);
    const file = path.join(p.trips, `${id}.yaml`);
    if (!fs.existsSync(file)) return { removed: 0, kept: 0 };
    const manifest: PhotoManifest = fs.existsSync(p.manifest)
        ? PhotoManifestSchema.parse(JSON.parse(fs.readFileSync(p.manifest, "utf8")))
        : {};

    let mine: string[] = [];
    try {
        mine = photoIds(YAML.parse(fs.readFileSync(file, "utf8")), manifest);
    } catch {
        // Can't tell which photos it has: delete the file only.
    }

    // What the other trips use. One that can't be read keeps every photo it mentions.
    const others = new Set<string>();
    const unread: string[] = [];
    for (const f of fs.readdirSync(p.trips).filter((f) => /\.ya?ml$/.test(f) && f !== `${id}.yaml`)) {
        const text = fs.readFileSync(path.join(p.trips, f), "utf8");
        try {
            photoIds(YAML.parse(text), manifest).forEach((x) => others.add(x));
        } catch {
            unread.push(text);
        }
    }
    const shared = (x: string) => others.has(x) || unread.some((t) => t.includes(x));

    // The trip's own folders (no other trip shows a photo from them) go entirely, with any
    // photos that were left out of its stops, like unsorted/. Elsewhere, only the trip's photos go.
    const tops = new Set(mine.flatMap((x) => topOf(x) ?? []));
    for (const x of others) tops.delete(topOf(x) ?? "");
    for (const t of [...tops]) if (unread.some((u) => u.includes(t))) tops.delete(t);
    const gone = new Set([...mine.filter((x) => !shared(x)), ...Object.keys(manifest).filter((x) => tops.has(topOf(x) ?? ""))]);

    const photosDir = path.join(root, "photos");
    const webDir = path.join(root, "public", "photos");
    for (const t of tops) {
        for (const dir of [path.join(photosDir, t), path.join(webDir, "full", t), path.join(webDir, "thumb", t)]) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    for (const x of gone) {
        delete manifest[x];
        for (const sub of ["full", "thumb"]) {
            for (const ext of [".webp", ".mp4"]) fs.rmSync(path.join(webDir, sub, x + ext), { force: true });
        }
        // The original, whatever its extension.
        const dir = path.join(photosDir, path.dirname(x));
        const stem = path.basename(x);
        if (fs.existsSync(dir)) {
            for (const f of fs.readdirSync(dir)) {
                const orig = path.join(dir, f);
                if (f.replace(/\.[^.]+$/, "") === stem && fs.statSync(orig).isFile()) fs.rmSync(orig);
            }
        }
        pruneUp(path.dirname(path.join(photosDir, x)), photosDir);
        for (const sub of ["full", "thumb"]) pruneUp(path.dirname(path.join(webDir, sub, x)), path.join(webDir, sub));
    }

    if (gone.size) fs.writeFileSync(p.manifest, manifestJson(manifest));
    fs.rmSync(file);
    return { removed: gone.size, kept: new Set(mine).size - mine.filter((x) => gone.has(x)).length };
};
