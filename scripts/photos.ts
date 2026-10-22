/**
 * npm run photos [-- --force] [-- --prune] [-- <folder>...]
 *
 * Turns the full-size originals in photos/ (not committed) into web-sized copies:
 *   public/photos/full/<id>.webp   longest side 1600px   (videos and animated GIFs -> .mp4)
 *   public/photos/thumb/<id>.webp  longest side 480px
 * and records them in data/photos.json, which trip files are checked against.
 * <id> is the path under photos/ without its extension, e.g. "iceland/12".
 *
 * Camera metadata (including GPS) is stripped from the output.
 * Already-processed photos are skipped unless the original changed or --force is given.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp, { type Sharp } from "sharp";
import { paths } from "./lib/load.ts";
import { resolveDataDir } from "./lib/site.ts";
import { type PhotoManifest, PhotoManifestSchema } from "./lib/schema.ts";
import { manifestJson } from "./lib/write.ts";

export const FULL_SIZE = 1600;
export const THUMB_SIZE = 480;
const VIDEO_SIZE = 1280;

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const UNSUPPORTED = new Set([".heic", ".heif"]);

const root = resolveDataDir();
const srcDir = path.join(root, "photos");
const outDir = path.join(root, "public", "photos");

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

const walk = (dir: string): string[] =>
    fs.existsSync(dir)
        ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
              e.name.startsWith(".")
                  ? []
                  : e.isDirectory()
                    ? walk(path.join(dir, e.name))
                    : [path.join(dir, e.name)]
          )
        : [];

const idOf = (file: string) =>
    path.relative(srcDir, file).split(path.sep).join("/").replace(/\.[^./]+$/, "");

const isNewer = (src: string, out: string) =>
    !fs.existsSync(out) || fs.statSync(src).mtimeMs > fs.statSync(out).mtimeMs;

const ensureDir = (file: string) => fs.mkdirSync(path.dirname(file), { recursive: true });

const thumbnail = async (input: Sharp | Buffer, out: string) => {
    ensureDir(out);
    await (Buffer.isBuffer(input) ? sharp(input) : input)
        .rotate()
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 70 })
        .toFile(out);
};

const ffprobeSize = (file: string) => {
    const [w, h] = execFileSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
    ]).toString().trim().split(",").map(Number);
    return { width: w, height: h };
};

const toMp4 = (src: string, out: string, hasAudio: boolean) => {
    ensureDir(out);
    execFileSync("ffmpeg", [
        "-y", "-v", "error", "-i", src,
        // Fit inside VIDEO_SIZE, keep even dimensions for H.264.
        "-vf", `scale='min(${VIDEO_SIZE},iw)':'min(${VIDEO_SIZE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
        "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-map_metadata", "-1",
        ...(hasAudio ? ["-c:a", "aac", "-b:a", "96k"] : ["-an"]),
        out,
    ]);
};

const firstFrame = (src: string) =>
    execFileSync("ffmpeg", ["-v", "error", "-i", src, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], {
        maxBuffer: 256 * 1024 * 1024,
    });

type Entry = PhotoManifest[string];

const processFile = async (src: string, force: boolean): Promise<Entry | null> => {
    const id = idOf(src);
    const ext = path.extname(src).toLowerCase();
    const thumbOut = path.join(outDir, "thumb", `${id}.webp`);

    if (VIDEO_EXT.has(ext) || ext === ".gif") {
        const animated = ext === ".gif" ? ((await sharp(src).metadata()).pages ?? 1) > 1 : true;
        if (animated && hasFfmpeg) {
            const out = path.join(outDir, "full", `${id}.mp4`);
            if (force || isNewer(src, out)) {
                const audio = ext !== ".gif" &&
                    execFileSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src]).toString().trim() !== "";
                toMp4(src, out, audio);
                await thumbnail(firstFrame(out), thumbOut);
            }
            return { kind: "video", ...ffprobeSize(out) };
        }
        if (VIDEO_EXT.has(ext)) {
            throw new Error("needs ffmpeg to process videos (https://ffmpeg.org/download.html)");
        }
        if (animated) {
            // No ffmpeg: fall back to an animated WebP, larger than MP4 but still far smaller than GIF.
            const out = path.join(outDir, "full", `${id}.webp`);
            if (force || isNewer(src, out)) {
                ensureDir(out);
                await sharp(src, { animated: true })
                    .resize(VIDEO_SIZE, VIDEO_SIZE, { fit: "inside", withoutEnlargement: true })
                    .webp({ quality: 70 })
                    .toFile(out);
                await thumbnail(sharp(src), thumbOut);
            }
            const m = await sharp(out).metadata();
            return { kind: "image", width: m.width!, height: m.pageHeight ?? m.height! };
        }
    }

    if (!IMAGE_EXT.has(ext)) return null;
    const out = path.join(outDir, "full", `${id}.webp`);
    if (force || isNewer(src, out)) {
        ensureDir(out);
        await sharp(src)
            .rotate() // apply EXIF orientation before metadata is dropped
            .resize(FULL_SIZE, FULL_SIZE, { fit: "inside", withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(out);
        await thumbnail(sharp(src), thumbOut);
    }
    const m = await sharp(out).metadata();
    return { kind: "image", width: m.width!, height: m.height! };
};

export const processPhotos = async (opts: { force?: boolean; prune?: boolean; only?: string[] } = {}) => {
    const manifestFile = paths(root).manifest;
    const manifest: PhotoManifest = fs.existsSync(manifestFile)
        ? PhotoManifestSchema.parse(JSON.parse(fs.readFileSync(manifestFile, "utf8")))
        : {};

    const only = opts.only?.map((f) => f.replace(/^photos\/|\/+$/g, ""));
    const files = walk(srcDir).filter((f) => !only?.length || only.some((o) => idOf(f).startsWith(o + "/")));
    const seen = new Map<string, string>();
    const failures: string[] = [];
    let done = 0;

    const queue = [...files];
    const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
            const id = idOf(f);
            const ext = path.extname(f).toLowerCase();
            const rel = path.relative(root, f);
            if (UNSUPPORTED.has(ext)) {
                failures.push(`${rel}: HEIC isn't supported; export as JPEG (iPhone: Settings > Camera > Formats > Most Compatible)`);
                continue;
            }
            if (seen.has(id)) {
                failures.push(`${rel}: same name as ${seen.get(id)}; rename one of them`);
                continue;
            }
            seen.set(id, rel);
            try {
                const entry = await processFile(f, !!opts.force);
                if (entry) manifest[id] = entry;
            } catch (e) {
                failures.push(`${rel}: ${(e as Error).message}`);
            }
            done++;
            if (done % 25 === 0) console.log(`  ${done}/${files.length}`);
        }
    };
    await Promise.all(Array.from({ length: 4 }, worker));

    // Originals aren't committed, so a missing original is normal on a fresh clone:
    // only drop photos from the manifest when explicitly asked to.
    if (opts.prune) {
        for (const id of Object.keys(manifest)) {
            if (seen.has(id)) continue;
            delete manifest[id];
            for (const sub of ["full", "thumb"]) {
                for (const ext of [".webp", ".mp4"]) fs.rmSync(path.join(outDir, sub, id + ext), { force: true });
            }
            console.log(`  pruned ${id}`);
        }
        const removeEmpty = (dir: string) => {
            if (!fs.existsSync(dir)) return;
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (e.isDirectory()) removeEmpty(path.join(dir, e.name));
            }
            if (dir !== outDir && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
        };
        removeEmpty(outDir);
    }

    fs.writeFileSync(manifestFile, manifestJson(manifest));
    return { processed: done, failures, manifest };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter((a) => a.startsWith("--")));
    const only = args.filter((a) => !a.startsWith("--"));
    if (!fs.existsSync(srcDir)) {
        console.error("No photos/ folder. Put original photos in photos/<trip>/ first (see README).");
        process.exit(1);
    }
    if (!hasFfmpeg) console.warn("ffmpeg not found: animated GIFs become animated WebP, videos are skipped.");
    console.log(`Processing photos${only.length ? ` in ${only.join(", ")}` : ""}...`);
    const { processed, failures } = await processPhotos({ force: flags.has("--force"), prune: flags.has("--prune"), only });
    console.log(`Done: ${processed} photos -> public/photos, manifest in data/photos.json`);
    if (failures.length) {
        console.error(`\n${failures.length} problem(s):\n  ` + failures.join("\n  "));
        process.exit(1);
    }
}
