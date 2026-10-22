/**
 * Finds the photos a stop can probably do without: blurry shots, and near-duplicates such
 * as burst frames or the same view taken twice. Only suggests; the studio shows what it
 * found and you choose what to remove.
 *
 * Works on the web thumbnails (public/photos/thumb/), so it runs without the originals.
 */
import fs from "node:fs";
import sharp from "sharp";

/** Measured on the thumbnail, scaled to fit inside this many pixels so photos compare fairly. */
const SIZE = 480;
/** Below this, a photo is blurry whatever else the stop holds. */
export const BLURRY = 40;
/** Or below this share of the stop's typical sharpness (with enough photos to tell). */
const SOFTER = 0.15;
/** Bits (of 64) two photos' hashes may differ by and still look the same. */
const SAME = 10;
/** A looser match for photos taken one after another: burst frames and retakes. */
const BURST = 14;

export interface PhotoScore {
    /** Variance of the Laplacian: high when there are crisp edges, low when blurred. */
    sharpness: number;
    /** Difference hash: 64 bits from how brightness changes across a 9x8 grey version. */
    hash: bigint;
}

export interface PhotoFlag {
    blurry?: true;
    /** The id of a better photo of the same view, kept in its place. */
    similarTo?: string;
}

/** Scores one image file (any format sharp reads). */
export const scorePhoto = async (file: string): Promise<PhotoScore> => {
    // Read here rather than by sharp, which caches by path and would miss a regenerated thumbnail.
    const bytes = fs.readFileSync(file);
    const { data, info } = await sharp(bytes)
        .greyscale()
        .resize(SIZE, SIZE, { fit: "inside", withoutEnlargement: true })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    let sum = 0;
    let sq = 0;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const v = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i];
            sum += v;
            sq += v * v;
        }
    }
    const n = Math.max(1, (w - 2) * (h - 2));
    const sharpness = sq / n - (sum / n) ** 2;

    const grid = await sharp(bytes).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let hash = 0n;
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) hash = (hash << 1n) | (grid[y * 9 + x] > grid[y * 9 + x + 1] ? 1n : 0n);
    }
    return { sharpness: Math.round(sharpness), hash };
};

export const distance = (a: bigint, b: bigint) => {
    let x = a ^ b;
    let n = 0;
    for (; x; x &= x - 1n) n++;
    return n;
};

const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2 : 0;
};

/**
 * Flags one stop's photos, given in the stop's order (so burst frames sit next to each other).
 * Of each set of near-duplicates the sharpest stays.
 */
export const reviewStop = (photos: ({ id: string } & PhotoScore)[]): Record<string, PhotoFlag> => {
    const flags: Record<string, PhotoFlag> = {};
    const typical = median(photos.map((p) => p.sharpness));
    const blurry = (p: PhotoScore) => p.sharpness < BLURRY || (photos.length >= 4 && p.sharpness < typical * SOFTER);
    for (const p of photos) if (blurry(p)) flags[p.id] = { blurry: true };

    // Join near-duplicates into sets.
    const parent = photos.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < photos.length; i++) {
        for (let j = i + 1; j < photos.length; j++) {
            const limit = j === i + 1 ? BURST : SAME;
            if (distance(photos[i].hash, photos[j].hash) <= limit) parent[root(j)] = root(i);
        }
    }
    const sets = new Map<number, number[]>();
    photos.forEach((_, i) => sets.set(root(i), [...(sets.get(root(i)) ?? []), i]));
    for (const set of sets.values()) {
        if (set.length < 2) continue;
        const keep = set.reduce((best, i) => (photos[i].sharpness > photos[best].sharpness ? i : best));
        for (const i of set) {
            if (i !== keep) flags[photos[i].id] = { ...flags[photos[i].id], similarTo: photos[keep].id };
        }
    }
    return flags;
};
