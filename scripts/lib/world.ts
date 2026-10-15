import { createRequire } from "node:module";
import { type Continent, CONTINENTS, type WorldInfo } from "../../src/types.ts";
import { countryFeatures } from "./countries.ts";

interface Country {
    cca3: string;
    ccn3: string;
    name: { common: string };
    region: string;
    subregion: string;
    unMember: boolean;
}

let all: Country[] | undefined;
const load = () => (all ??= createRequire(import.meta.url)("world-countries") as Country[]);

/** The Americas split at Panama: Central America and the Caribbean count as North America. */
const continentOf = (c: Country): Continent | undefined =>
    c.region === "Americas"
        ? c.subregion === "South America" ? "South America" : "North America"
        : (CONTINENTS as readonly string[]).includes(c.region) ? (c.region as Continent) : undefined;

/** UN members plus the observer states (Vatican City, Palestine): 195 countries. */
const counted = (c: Country) => c.unMember || c.cca3 === "VAT" || c.cca3 === "PSE";

/** World totals, and the continent of each visited country (matched by ISO numeric code, else by name). */
export const worldInfo = (visited: Iterable<string>): WorldInfo => {
    const countries = load();
    const byCode = new Map(countries.map((c) => [c.ccn3, c]));
    const byName = new Map(countries.map((c) => [c.name.common, c]));
    const codeOf = new Map(countryFeatures().map((f) => [f.properties.name, f.id === undefined ? undefined : String(f.id)]));

    const continents = Object.fromEntries(CONTINENTS.map((k) => [k, 0])) as Record<Continent, number>;
    for (const c of countries) {
        const k = continentOf(c);
        if (k && counted(c)) continents[k]++;
    }
    const info: WorldInfo["countries"] = {};
    for (const name of visited) {
        const code = codeOf.get(name);
        const c = (code && byCode.get(code)) || byName.get(name);
        const continent = c && continentOf(c);
        info[name] = { ...(continent ? { continent } : {}), counted: !!c && counted(c) };
    }
    return { total: countries.filter(counted).length, continents, countries: info };
};
