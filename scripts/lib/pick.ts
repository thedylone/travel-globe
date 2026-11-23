/**
 * Picks the best few photos of each stop, so a trip with hundreds of photos doesn't need
 * them sorted by hand. Only suggests: the studio shows the picks ticked, with the runners-up
 * beside each, and you choose what stays.
 *
 * Each photo gets a score from its thumbnail (sharpness, exposure, contrast, colour, and
 * where its detail sits in the frame), plus a boost for ones you starred or edited, read
 * from the original's metadata when it's there. Photos the review marks as blurry or as
 * repeats are left out. Then a stop's photos are split into moments (photos taken together),
 * and the best photo of each of the best moments is picked, so the picks are of different
 * things rather than five shots of one view.
 *
 * All of it runs on this computer.
 */
import fs from "node:fs";
import path from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import { distance, type PhotoFlag } from "./review.ts";

/** Measured at this size: small is enough for light and layout, and quick. */
const SIZE = 96;
/** Neighbouring photos whose hashes differ by more than this start a new moment (when no times are known). */
const NEW_MOMENT = 22;
/** Runners-up shown beside each pick. */
const RUNNERS_UP = 4;

export interface PhotoLook {
    /** Mean brightness, 0..1. */
    brightness: number;
    /** Share of pixels that are nearly black, and nearly white. */
    shadows: number;
    highlights: number;
    /** Standard deviation of brightness, 0..1. */
    contrast: number;
    /** Hasler and Süsstrunk's colourfulness, roughly 0..1. */
    colour: number;
    /** How close the centre of the photo's detail is to the middle or a third line, 0..1. */
    layout: number;
}

export interface PhotoMeta {
    /** Star rating (0..5) from XMP or Windows, set by Lightroom, Photos exports and the like. */
    rating?: number;
    /** Saved by an editing app, which usually means you thought it worth editing. */
    edited?: true;
}

/** Measures how a photo looks, from any image file sharp reads. */
export const lookOf = async (file: string): Promise<PhotoLook> => {
    const bytes = fs.readFileSync(file);
    const { data, info } = await sharp(bytes)
        .removeAlpha()
        .resize(SIZE, SIZE, { fit: "inside" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = info;
    const n = w * h;
    const lum = new Float64Array(n);
    let sum = 0;
    let dark = 0;
    let bright = 0;
    let rg = 0;
    let yb = 0;
    let rg2 = 0;
    let yb2 = 0;
    for (let i = 0; i < n; i++) {
        const [r, g, b] = [data[i * c], data[i * c + 1], data[i * c + 2]];
        const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        lum[i] = y;
        sum += y;
        if (y < 0.03) dark++;
        if (y > 0.97) bright++;
        const a = r - g;
        const d = (r + g) / 2 - b;
        rg += a;
        yb += d;
        rg2 += a * a;
        yb2 += d * d;
    }
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (lum[i] - mean) ** 2;
    const sd = (x2: number, x: number) => Math.sqrt(Math.max(0, x2 / n - (x / n) ** 2));
    const colour = (Math.hypot(sd(rg2, rg), sd(yb2, yb)) + 0.3 * Math.hypot(rg / n, yb / n)) / 150;

    // Where the detail is: the centre of the edges, weighted by how strong they are.
    let ex = 0;
    let ey = 0;
    let et = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const e = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + w] - lum[i - w]);
            ex += e * x;
            ey += e * y;
            et += e;
        }
    }
    const cx = et ? ex / et / (w - 1) : 0.5;
    const cy = et ? ey / et / (h - 1) : 0.5;
    const near = (p: number) => Math.min(...[1 / 3, 1 / 2, 2 / 3].map((t) => Math.abs(p - t)));
    const layout = Math.max(0, 1 - (near(cx) + near(cy)) / 0.34);

    return {
        brightness: mean,
        shadows: dark / n,
        highlights: bright / n,
        contrast: Math.sqrt(v / n),
        colour: Math.min(1, colour),
        layout,
    };
};

/** The original of a photo id (photos/<id>.<any extension>), if it's on this computer. */
export const originalOf = (dataDir: string, id: string) => {
    const dir = path.join(dataDir, "photos", path.dirname(id));
    const stem = path.basename(id);
    if (!fs.existsSync(dir)) return undefined;
    const name = fs.readdirSync(dir).find((f) => f.slice(0, f.length - path.extname(f).length) === stem && path.extname(f));
    return name ? path.join(dir, name) : undefined;
};

const EDITORS = /lightroom|photoshop|snapseed|vsco|darktable|capture one|affinity|pixelmator|luminar|afterlight|picsart/i;

/** Reads the rating and editing app from an original, if it has them. */
export const metaOf = async (file: string): Promise<PhotoMeta> => {
    const tags = await exifr
        .parse(file, { xmp: true, tiff: true, exif: false, gps: false, pick: ["Rating", "RatingPercent", "Software", "CreatorTool"] })
        .catch(() => undefined);
    const rating = Number(tags?.Rating ?? (tags?.RatingPercent ? tags.RatingPercent / 20 : 0));
    const tool = `${tags?.Software ?? ""} ${tags?.CreatorTool ?? ""}`;
    return {
        ...(rating > 0 ? { rating: Math.min(5, rating) } : {}),
        ...(EDITORS.test(tool) ? { edited: true as const } : {}),
    };
};

export interface Candidate {
    id: string;
    /** From the review (variance of the Laplacian) and its difference hash. */
    sharpness: number;
    hash: bigint;
    look: PhotoLook;
    meta?: PhotoMeta;
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};

/**
 * A photo's score, 0..1 and a little over with a boost. Sharpness counts against the stop's
 * typical sharpness, as a city at noon and a forest at dusk differ whatever the camera does.
 */
export const scoreOf = (p: Candidate, typicalSharpness: number) => {
    const { look } = p;
    const sharp = clamp(0.5 + Math.log2(Math.max(1, p.sharpness) / Math.max(1, typicalSharpness)) / 4);
    const exposure = clamp(1 - Math.abs(look.brightness - 0.47) / 0.4 - 2 * Math.max(0, look.shadows - 0.05) - 3 * Math.max(0, look.highlights - 0.03));
    const contrast = clamp(look.contrast / 0.22);
    const parts = 0.35 * sharp + 0.25 * exposure + 0.15 * contrast + 0.15 * look.colour + 0.1 * look.layout;
    const boost = (p.meta?.rating ? 0.06 * p.meta.rating : 0) + (p.meta?.edited ? 0.08 : 0);
    return Math.round((parts + boost) * 1000) / 1000;
};

/**
 * Splits a stop's photos (in order) into moments, for when their times aren't known:
 * a new moment starts wherever a photo looks unlike the one before it.
 */
export const momentsByLook = (photos: { id: string; hash: bigint }[]): string[][] => {
    const out: string[][] = [];
    photos.forEach((p, i) => {
        if (i && distance(photos[i - 1].hash, p.hash) <= NEW_MOMENT) out[out.length - 1].push(p.id);
        else out.push([p.id]);
    });
    return out;
};

/** How many to pick from a stop of `n` photos when you don't say: a few, growing slowly with the stop. */
export const autoPer = (n: number) => Math.min(n, Math.max(3, Math.min(12, Math.round(Math.sqrt(n)))));

export interface Pick {
    id: string;
    score: number;
    /** The next best photos of the same moment, best first: one click swaps one in. */
    runnersUp: string[];
}

export interface StopPicks {
    /** In the stop's order. */
    picks: Pick[];
    /** Every scored photo's score, by id, so the studio can sort what it shows. */
    scores: Record<string, number>;
    /** Photos considered (not videos, and only those with a thumbnail). */
    considered: number;
}

/**
 * Picks up to `per` photos of one stop, at most one per moment. `moments` are lists of photo
 * ids taken together; photos in none of them are each their own moment. Photos with a flag
 * (blurry, or a repeat of a better one) aren't picked; repeats can be runners-up, blurry ones can't.
 */
export const pickStop = (
    photos: Candidate[],
    { per, moments, flags = {} }: { per: number; moments?: string[][]; flags?: Record<string, PhotoFlag> }
): StopPicks => {
    const typical = median(photos.map((p) => p.sharpness));
    const scores = Object.fromEntries(photos.map((p) => [p.id, scoreOf(p, typical)]));
    const order = new Map(photos.map((p, i) => [p.id, i]));
    const groups = (moments ?? momentsByLook(photos)).map((m) => m.filter((id) => order.has(id)));
    const grouped = new Set(groups.flat());
    for (const p of photos) if (!grouped.has(p.id)) groups.push([p.id]);

    // A repeat isn't picked, but can be a runner-up: it's often the shot you'd swap in.
    const byScore = (a: string, b: string) => scores[b] - scores[a];
    const best = groups
        .map((ids) => ({
            pick: ids.filter((id) => !flags[id]).sort(byScore)[0],
            others: ids.filter((id) => !flags[id]?.blurry).sort(byScore),
        }))
        .filter((g): g is { pick: string; others: string[] } => g.pick !== undefined)
        .sort((a, b) => scores[b.pick] - scores[a.pick])
        .slice(0, Math.max(0, per));
    const picks = best
        .map(({ pick, others }) => ({ id: pick, score: scores[pick], runnersUp: others.filter((id) => id !== pick).slice(0, RUNNERS_UP) }))
        .sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { picks, scores, considered: photos.length };
};
