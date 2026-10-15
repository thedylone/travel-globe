import path from "node:path";
import type { Plugin } from "vite";
import { nominatimSearch } from "./lib/geocode.ts";
import { loadTravelData } from "./lib/load.ts";

const VIRTUAL = "virtual:travel-data";
const RESOLVED = "\0" + VIRTUAL;

/**
 * Serves data/ as `import data from "virtual:travel-data"`.
 * Problems in trip files show as an error overlay in dev and fail the build.
 * In dev, editing anything in data/ reloads the page.
 */
export const travelData = (): Plugin => {
    let root = process.cwd();
    return {
        name: "travel-data",
        configResolved(config) {
            root = config.root;
        },
        resolveId(id) {
            if (id === VIRTUAL) return RESOLVED;
        },
        async load(id) {
            if (id !== RESOLVED) return;
            const { data, errors, warnings, files } = await loadTravelData({ root, geocoder: nominatimSearch });
            for (const f of files) this.addWatchFile(f);
            for (const w of warnings) this.warn(w);
            if (errors.length) this.error(`Problems in data/:\n  ${errors.join("\n  ")}`);
            return `export default ${JSON.stringify(data)};`;
        },
        configureServer(server) {
            const dataDir = path.join(root, "data");
            server.watcher.add(dataDir);
            const onChange = (file: string) => {
                if (!file.startsWith(dataDir)) return;
                const mod = server.moduleGraph.getModuleById(RESOLVED);
                if (mod) server.moduleGraph.invalidateModule(mod);
                server.ws.send({ type: "full-reload" });
            };
            server.watcher.on("add", onChange).on("change", onChange).on("unlink", onChange);
        },
    };
};
