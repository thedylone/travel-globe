/**
 * npm run stats-image [-- <out dir>]   (default: dist/, run by `npm run build`)
 *
 * Renders the shareable stats card as PNGs, so the deployed site always has
 * up-to-date images at fixed URLs that can be embedded anywhere:
 *   stats.png         1080×1350  Instagram post
 *   stats-story.png   1080×1920  stories
 *   stats-wide.png    1200×630   link previews (the site's og:image)
 * each also as a light version: stats-light.png, stats-story-light.png, stats-wide-light.png.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderShareSvg, SHARE_SIZES, type ShareSize, type ShareTheme } from "../src/lib/share.ts";
import { computeStats } from "../src/lib/stats.ts";
import { countryFeatures } from "./lib/countries.ts";
import { loadTravelData } from "./lib/load.ts";

const root = process.cwd();
const outDir = path.resolve(process.argv[2] ?? "dist");
const FILES: Record<ShareSize, string> = { post: "stats", story: "stats-story", wide: "stats-wide" };
const fileName = (size: ShareSize, theme: ShareTheme) => `${FILES[size]}${theme === "light" ? "-light" : ""}.png`;

// Render text with the bundled font, the same one the browser export embeds:
// point fontconfig at public/fonts (plus the system fonts as a fallback).
const fontDir = path.join(root, "public", "fonts");
const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "fonts-"));
fs.writeFileSync(
    path.join(confDir, "fonts.conf"),
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>` +
        `<dir>${fontDir}</dir><include ignore_missing="yes">/etc/fonts/fonts.conf</include>` +
        `<cachedir>${confDir}/cache</cachedir></fontconfig>`
);
process.env.FONTCONFIG_FILE = path.join(confDir, "fonts.conf");
// Imported after FONTCONFIG_FILE is set, so its text rendering picks up the font.
const { default: sharp } = await import("sharp");

const { data, errors } = await loadTravelData({ root, geocoder: false });
if (errors.length) {
    console.error(`Fix data/ first:\n  ${errors.join("\n  ")}`);
    process.exit(1);
}
const stats = computeStats(data.trips, data.world);
const homepage = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).homepage as string | undefined;
const input = {
    countries: countryFeatures(),
    stops: data.trips.flatMap((t) => t.stops),
    stats,
    url: (homepage ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
};

fs.mkdirSync(outDir, { recursive: true });
for (const theme of ["dark", "light"] as const) {
    for (const size of Object.keys(SHARE_SIZES) as ShareSize[]) {
        const file = path.join(outDir, fileName(size, theme));
        await sharp(Buffer.from(renderShareSvg({ ...input, size, theme }))).png({ compressionLevel: 9 }).toFile(file);
        console.log(`wrote ${path.relative(root, file)}`);
    }
}
fs.rmSync(confDir, { recursive: true, force: true });
