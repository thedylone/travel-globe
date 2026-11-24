/**
 * travel-globe <command> [--data <folder>] [options]
 *
 * The command a data repo's npm scripts call. Every command works on one data folder:
 * --data, else $TRAVEL_GLOBE_DATA, else the current folder if it has a site.yaml,
 * else the bundled example/ (see README, "Data folder").
 */
import fs from "node:fs";
import path from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { build, createServer, preview } from "vite";
// Nothing here may import a script that `run` starts (e.g. photos.ts through the studio plugin):
// it would already be loaded, so importing it again wouldn't run it.
import { DATA_ENV, ENGINE_ROOT, EXAMPLE_DIR, loadSite, resolveDataDir, STUDIO_ENV } from "./lib/site.ts";

const USAGE = `Usage: travel-globe <command> [--data <folder>]

  init [<folder>]             start a data repo in <folder> (default: my-travels), with the sample trips
  dev [--host] [--port <n>]   dev server; reloads when the data changes
  studio [--port <n>]         edit trips and import photos in your browser
  build [--out <folder>]      production build (default: dist/), including the stats images
  preview [--out <folder>]    serve a finished build
  check [--offline]           validate the data, look up new places
  photos [--force] [--prune]  make web versions of new photos in photos/
  import <folder> [...]       draft a trip from a folder of photos
  stats-image [<folder>]      render just the stats images (default: dist/)`;

const [command, ...rest] = process.argv.slice(2);

// --data is common to every command; the rest are passed on.
const args: string[] = [];
let data: string | undefined;
for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--data") data = rest[++i];
    else if (rest[i].startsWith("--data=")) data = rest[i].slice("--data=".length);
    else args.push(rest[i]);
}
process.env[DATA_ENV] = resolveDataDir(data);

const configFile = path.join(ENGINE_ROOT, "vite.config.ts");
const script = (name: string) => path.join(ENGINE_ROOT, "scripts", `${name}.ts`);
/** Runs one of the scripts as if it had been started directly with these arguments. */
const run = async (name: string, scriptArgs: string[]) => {
    process.argv = [process.argv[0], script(name), ...scriptArgs];
    await import(script(name));
};

const option = <T extends ParseArgsOptionsConfig>(options: T) =>
    parseArgs({ args, options, allowPositionals: false, strict: true }).values;

/** What a new data repo leaves out of git. Written here because npm drops .gitignore files when it installs the engine. */
const GITIGNORE = `node_modules/
dist/
# Not committed, so every build installs the engine's latest version (see the engine's README, "Engine updates").
package-lock.json
# Original, full-size photos: large, and they contain GPS data (see the engine's README, "Photos").
photos/
`;

switch (command) {
    case "init": {
        const target = path.resolve(args[0] ?? "my-travels");
        if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
            console.error(`${target} already exists and isn't empty.`);
            process.exit(1);
        }
        fs.cpSync(EXAMPLE_DIR, target, { recursive: true });
        fs.writeFileSync(path.join(target, ".gitignore"), GITIGNORE);
        const pkgFile = path.join(target, "package.json");
        const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
        pkg.name = path.basename(target).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
        fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
        const relPath = path.relative(process.cwd(), target) || ".";
        const rel = /\s/.test(relPath) ? `"${relPath}"` : relPath;
        console.log(`Made a data folder in ${rel}, with sample trips. Next:

  cd ${rel}
  npm install
  npm run dev          # see it at http://localhost:5173/

Then make it a GitHub repo, push it, and set Settings > Pages > Source: GitHub Actions.
See "Your own site" in https://github.com/thedylone/travel-globe#your-own-site`);
        break;
    }
    case "dev": {
        const o = option({ host: { type: "boolean" }, port: { type: "string" } });
        const server = await createServer({
            configFile,
            server: { ...(o.host ? { host: true } : {}), ...(o.port ? { port: Number(o.port) } : {}) },
        });
        await server.listen();
        console.log(`  Data: ${process.env[DATA_ENV]}`);
        server.printUrls();
        server.bindCLIShortcuts({ print: true });
        break;
    }
    case "studio": {
        // The same dev server with the studio's API on; localhost only, as it writes files.
        const o = option({ port: { type: "string" } });
        process.env[STUDIO_ENV] = "1";
        const server = await createServer({
            configFile,
            server: { open: `${loadSite(process.env[DATA_ENV]).base}studio.html`, ...(o.port ? { port: Number(o.port) } : {}) },
        });
        await server.listen();
        console.log(`  Data: ${process.env[DATA_ENV]}`);
        server.printUrls();
        server.bindCLIShortcuts({ print: true });
        break;
    }
    case "build": {
        const o = option({ out: { type: "string", default: "dist" } });
        const outDir = path.resolve(o.out);
        console.log(`Building ${process.env[DATA_ENV]} into ${outDir}`);
        await build({ configFile, build: { outDir } });
        await run("stats-image", [outDir]);
        break;
    }
    case "preview": {
        const o = option({ out: { type: "string", default: "dist" }, port: { type: "string" } });
        const server = await preview({
            configFile,
            build: { outDir: path.resolve(o.out) },
            preview: o.port ? { port: Number(o.port) } : {},
        });
        server.printUrls();
        break;
    }
    case "check":
    case "photos":
    case "import":
    case "stats-image":
        await run(command, args);
        break;
    default:
        console.log(USAGE);
        process.exit(command && !["help", "--help", "-h"].includes(command) ? 1 : 0);
}
