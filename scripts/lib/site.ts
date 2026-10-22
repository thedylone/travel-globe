import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { z } from "zod";
import { formatIssues } from "./schema.ts";

/** Where the engine is installed: this repo, or node_modules/travel-globe in a data repo. */
export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Sample trips, used when there's no data folder to show. */
export const EXAMPLE_DIR = path.join(ENGINE_ROOT, "example");
/** Set by the travel-globe command so Vite and every script read the same data folder. */
export const DATA_ENV = "TRAVEL_GLOBE_DATA";
export const SITE_FILE = "site.yaml";
/** Set by `travel-globe studio` to add the studio's API to the dev server. */
export const STUDIO_ENV = "TRAVEL_GLOBE_STUDIO";

/**
 * The data folder to use: the one given, else $TRAVEL_GLOBE_DATA, else the current
 * folder if it has a site.yaml, else the bundled example.
 */
export const resolveDataDir = (given?: string) => {
    const dir = given ?? process.env[DATA_ENV];
    if (dir) return path.resolve(dir);
    if (fs.existsSync(path.join(process.cwd(), SITE_FILE))) return process.cwd();
    return EXAMPLE_DIR;
};

const SiteSchema = z.strictObject({
    /** Shown at the top of the trip list and in the browser tab. */
    title: z.string().min(1).default("Travel History"),
    /** Whose travels these are, for link previews: "<name>'s travels on an interactive globe". */
    name: z.string().min(1).optional(),
    /** Where the site is deployed. Its path is the base path the site is built for. */
    url: z.url({ protocol: /^https?$/ }).optional(),
    /** Social handle for link previews, e.g. "@thedylone". */
    twitter: z.string().regex(/^@\w+$/, 'use the form "@name"').optional(),
});

export interface Site extends z.infer<typeof SiteSchema> {
    description: string;
    /** Base path the site is served from, e.g. "/travel-history/". */
    base: string;
    /** The url without its scheme or trailing slash, as printed on the share image. */
    shortUrl: string;
}

/** Reads <data folder>/site.yaml. Every field is optional, as is the file. */
export const loadSite = (dataDir: string): Site => {
    const file = path.join(dataDir, SITE_FILE);
    const raw = fs.existsSync(file) ? (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) : {};
    const r = SiteSchema.safeParse(raw);
    if (!r.success) throw new Error(`Problems in ${file}:\n  ${formatIssues(r.error).join("\n  ")}`);
    const site = r.data;
    const url = site.url ? new URL(site.url) : undefined;
    return {
        ...site,
        description: site.name ? `${site.name}'s travels on an interactive globe` : "Travels on an interactive globe",
        base: url ? url.pathname.replace(/\/*$/, "/") : "/",
        shortUrl: url ? `${url.host}${url.pathname}`.replace(/\/+$/, "") : "",
    };
};
