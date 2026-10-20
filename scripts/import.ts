/**
 * npm run import -- <folder> [--title "Iceland"] [--from school] [--km 15] [--force]
 *
 * Makes a draft trip from a folder of photos straight off your phone or camera
 * (see scripts/lib/importer.ts for the steps).
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { ImportError, importTrip } from "./lib/importer.ts";
import { resolveDataDir } from "./lib/site.ts";

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        title: { type: "string" },
        from: { type: "string" },
        km: { type: "string", default: "15" },
        force: { type: "boolean", default: false },
    },
});

const [srcArg] = positionals;
if (!srcArg) {
    console.error('Usage: npm run import -- <folder> [--title "Trip name"] [--from home|school|<place>] [--km 15]');
    process.exit(1);
}

try {
    const { problems } = await importTrip({
        root: resolveDataDir(),
        src: path.resolve(srcArg),
        title: values.title,
        from: values.from,
        km: Number(values.km),
        force: values.force,
    });
    if (problems.length) console.log(`Still to fix:\n  ${problems.join("\n  ")}`);
    console.log("Next: open the file, tidy it up, then `npm run dev` to see it on the globe.");
} catch (e) {
    if (!(e instanceof ImportError)) throw e;
    console.error(e.exists ? `${e.message} Pick another --title, or pass --force to replace it.` : e.message);
    process.exit(1);
}
