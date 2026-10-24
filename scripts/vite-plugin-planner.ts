import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import YAML from "yaml";
import { paths } from "./lib/load.ts";
import { BasesSchema } from "./lib/schema.ts";
import type { Site } from "./lib/site.ts";

const BASES = "virtual:travel-bases";
const RESOLVED = "\0" + BASES;

export const plannerManifest = (site: Site) =>
    JSON.stringify(
        {
            short_name: "Planner",
            name: `Trip planner · ${site.title}`,
            icons: [
                { src: "../favicon/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
                { src: "../favicon/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
                { src: "../favicon/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
            ],
            start_url: "./",
            scope: "./",
            display: "standalone",
            theme_color: "#040e20",
            background_color: "#040e20",
        },
        null,
        2
    );

/**
 * The service worker that keeps the planner working offline. It stores the planner's page and
 * every file it loads when it's installed; pages are fetched fresh when online, the rest (whose
 * names change with their contents) come from the store. A new build gets a new store.
 */
export const serviceWorker = (files: string[], version: string) => `// Made by scripts/vite-plugin-planner.ts.
const CACHE = "planner-${version}";
const FILES = ${JSON.stringify(files, null, 2)};
const PAGE = FILES[0];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith("planner-") && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));

self.addEventListener("fetch", (e) => {
    const req = e.request;
    if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
    if (req.mode === "navigate") {
        // The newest page when there's signal; the stored one when there isn't (or it's slow).
        e.respondWith(
            Promise.race([fetch(req), timeout(4000)])
                .then((res) => {
                    if (res.ok) caches.open(CACHE).then((c) => c.put(PAGE, res.clone()));
                    return res;
                })
                .catch(() => caches.match(PAGE))
        );
        return;
    }
    e.respondWith(
        caches.match(req).then(
            (hit) =>
                hit ??
                fetch(req).then((res) => {
                    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
                    return res;
                })
        )
    );
});
`;

/**
 * The trip planner (planner/index.html, src/planner/): a page for planning trips on a phone,
 * offline, that exports trip files for the studio. This
 * - serves data/bases.yaml as `import bases from "virtual:travel-bases"`, for "from" and "to".
 * - serves and builds planner/manifest.json, so the planner can be added to a home screen.
 * - writes planner/sw.js after a build, listing the files the planner needs offline.
 */
export const planner = ({ dataDir, site }: { dataDir: string; site: Site }): Plugin => {
    const basesFile = paths(dataDir).bases;
    let outDir = "";
    let base = "/";
    return {
        name: "travel-planner",
        configResolved(config) {
            outDir = path.resolve(config.root, config.build.outDir);
            base = config.base;
        },
        resolveId(id) {
            if (id === BASES) return RESOLVED;
        },
        load(id) {
            if (id !== RESOLVED) return;
            this.addWatchFile(basesFile);
            // Problems in bases.yaml are reported by the globe's data; here they just leave the list empty.
            const raw = fs.existsSync(basesFile) ? YAML.parse(fs.readFileSync(basesFile, "utf8")) : {};
            const r = BasesSchema.safeParse(raw ?? {});
            const bases = r.success ? Object.entries(r.data).map(([key, b]) => ({ key, name: b.name })) : [];
            return `export default ${JSON.stringify(bases)};`;
        },
        generateBundle() {
            this.emitFile({ type: "asset", fileName: "planner/manifest.json", source: plannerManifest(site) });
        },
        writeBundle() {
            const page = path.join(outDir, "planner", "index.html");
            if (!fs.existsSync(page)) return;
            const html = fs.readFileSync(page, "utf8");
            // Everything the page links to that's part of the site, and what its CSS loads (the font).
            const linked = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
            const css = linked.filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(outDir, f.slice(base.length)), "utf8"));
            const fromCss = css.flatMap((c) => [...c.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]));
            const files = [...new Set([`${base}planner/`, ...linked, ...fromCss])].filter(
                (f) => f.startsWith(base) && !f.startsWith("data:") && fs.existsSync(path.join(outDir, f.slice(base.length).replace(/\/$/, "/index.html")))
            );
            const version = createHash("sha256").update(html).update(files.join("\n")).digest("hex").slice(0, 12);
            fs.writeFileSync(path.join(outDir, "planner", "sw.js"), serviceWorker(files, version));
        },
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = (req.url ?? "").split("?")[0];
                if (url !== `${base}planner/manifest.json`) return next();
                res.setHeader("Content-Type", "application/json");
                res.end(plannerManifest(site));
            });
        },
    };
};
