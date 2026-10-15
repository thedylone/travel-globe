/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };
import { travelData } from "./scripts/vite-plugin-travel-data.ts";

export default defineConfig({
    base: "/travel-history/",
    plugins: [react(), travelData()],
    // Shown on the share image: "thedylone.github.io/travel-history".
    define: { __SITE_URL__: JSON.stringify(pkg.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")) },
    build: { chunkSizeWarningLimit: 2500 },
    test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
