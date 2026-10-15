/// <reference types="vitest/config" />
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { ENGINE_ROOT, loadSite, resolveDataDir } from "./scripts/lib/site.ts";
import { travelData } from "./scripts/vite-plugin-travel-data.ts";

// The data folder to show (see README, "Data folder"); the travel-globe command sets it.
const dataDir = resolveDataDir();
const site = loadSite(dataDir);

export default defineConfig({
    // The engine's own files (index.html, src/, public/), wherever it's installed.
    root: ENGINE_ROOT,
    base: site.base,
    plugins: [react(), travelData({ dataDir, site })],
    define: {
        // Shown on the share image, e.g. "thedylone.github.io/travel-history".
        __SITE_URL__: JSON.stringify(site.shortUrl),
        __SITE_TITLE__: JSON.stringify(site.title),
    },
    build: {
        // Next to the data, not inside the engine (which may be in node_modules).
        outDir: path.resolve("dist"),
        emptyOutDir: true,
        chunkSizeWarningLimit: 2500,
    },
    test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
