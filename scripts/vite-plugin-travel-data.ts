import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { nominatimSearch } from "./lib/geocode.ts";
import { loadTravelData } from "./lib/load.ts";
import { ENGINE_ROOT, type Site, SITE_FILE } from "./lib/site.ts";

const VIRTUAL = "virtual:travel-data";
const RESOLVED = "\0" + VIRTUAL;

const MIME: Record<string, string> = {
    ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm",
    ".json": "application/json", ".txt": "text/plain", ".ttf": "font/ttf", ".woff2": "font/woff2",
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const manifest = (site: Site) =>
    JSON.stringify(
        {
            short_name: site.title,
            name: site.title,
            icons: [
                { src: "favicon/favicon.ico", sizes: "64x64 32x32 24x24 16x16", type: "image/x-icon" },
                { src: "favicon/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
                { src: "favicon/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
                { src: "favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
                { src: "favicon/favicon-16x16.png", sizes: "16x16", type: "image/png" },
                { src: "favicon/favicon-32x32.png", sizes: "32x32", type: "image/png" },
            ],
            start_url: ".",
            display: "standalone",
            theme_color: "#000000",
            background_color: "#ffffff",
        },
        null,
        2
    );

/** Link-preview tags. The image is made by scripts/stats-image.ts on every build. */
const previewTags = (site: Site) => {
    const title = site.name ? `${site.name}'s travel history` : site.title;
    const tags: [string, string, string][] = [
        ["property", "og:title", title],
        ["property", "og:description", site.description],
        ["property", "og:type", "website"],
    ];
    if (site.url) {
        const url = site.url.replace(/\/*$/, "/");
        tags.push(
            ["property", "og:url", url],
            ["property", "og:image", `${url}stats-wide.png`],
            ["property", "og:image:width", "1200"],
            ["property", "og:image:height", "630"],
            ["name", "twitter:card", "summary_large_image"],
            ["name", "twitter:image", `${url}stats-wide.png`]
        );
    }
    if (site.twitter) tags.push(["name", "twitter:creator", site.twitter]);
    return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}" />`).join("\n    ");
};

/**
 * Connects the site to a data folder (see README, "Data folder"):
 * - serves its data/ as `import data from "virtual:travel-data"`. Problems in trip files
 *   show as an error overlay in dev and fail the build; editing anything in data/ or
 *   site.yaml reloads the page in dev.
 * - fills in index.html and manifest.json from its site.yaml.
 * - serves its public/ (photos, and anything that should replace the engine's own files,
 *   such as favicon/) next to the engine's public/, and copies it into the build.
 */
export const travelData = ({ dataDir, site }: { dataDir: string; site: Site }): Plugin => {
    const dataPublic = path.join(dataDir, "public");
    const separatePublic = fs.existsSync(dataPublic) && dataPublic !== path.join(ENGINE_ROOT, "public");
    let outDir = "";
    let base = "/";
    return {
        name: "travel-data",
        configResolved(config) {
            outDir = path.resolve(config.root, config.build.outDir);
            base = config.base;
        },
        resolveId(id) {
            if (id === VIRTUAL) return RESOLVED;
        },
        async load(id) {
            if (id !== RESOLVED) return;
            const { data, errors, warnings, files } = await loadTravelData({ root: dataDir, geocoder: nominatimSearch });
            for (const f of files) this.addWatchFile(f);
            for (const w of warnings) this.warn(w);
            if (errors.length) this.error(`Problems in ${path.join(dataDir, "data")}:\n  ${errors.join("\n  ")}`);
            return `export default ${JSON.stringify(data)};`;
        },
        transformIndexHtml(html) {
            return html
                .replaceAll("%SITE_TITLE%", escapeHtml(site.title))
                .replaceAll("%SITE_DESCRIPTION%", escapeHtml(site.description))
                .replace("<!-- %SITE_PREVIEW% -->", previewTags(site));
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "manifest.json", source: manifest(site) });
        },
        writeBundle() {
            if (separatePublic) fs.cpSync(dataPublic, outDir, { recursive: true });
        },
        configureServer(server) {
            const dataFolder = path.join(dataDir, "data");
            const siteFile = path.join(dataDir, SITE_FILE);
            server.watcher.add([dataFolder, siteFile]);
            const onChange = (file: string) => {
                if (file === siteFile) {
                    // The title, base path and so on are read once, when the server starts.
                    server.config.logger.info("site.yaml changed: restarting the server", { timestamp: true });
                    void server.restart();
                    return;
                }
                if (!file.startsWith(dataFolder + path.sep)) return;
                const mod = server.moduleGraph.getModuleById(RESOLVED);
                if (mod) server.moduleGraph.invalidateModule(mod);
                server.ws.send({ type: "full-reload" });
            };
            server.watcher.on("add", onChange).on("change", onChange).on("unlink", onChange);

            server.middlewares.use((req, res, next) => {
                const url = decodeURIComponent((req.url ?? "").split("?")[0]);
                if (!url.startsWith(base)) return next();
                const rel = url.slice(base.length);
                if (rel === "manifest.json") {
                    res.setHeader("Content-Type", "application/json");
                    res.end(manifest(site));
                    return;
                }
                if (!separatePublic || !rel) return next();
                const file = path.join(dataPublic, rel);
                if (!file.startsWith(dataPublic + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
                    return next();
                }
                res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
                fs.createReadStream(file).pipe(res);
            });
        },
    };
};
