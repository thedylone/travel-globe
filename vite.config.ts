/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { travelData } from "./scripts/vite-plugin-travel-data.ts";

export default defineConfig({
    base: "/travel-history/",
    plugins: [react(), travelData()],
    build: { chunkSizeWarningLimit: 2500 },
    test: { include: ["src/**/*.test.ts", "scripts/**/*.test.ts"] },
});
