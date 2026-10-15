import { geoEqualEarth, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { type CountryFeature, type CountryPart, splitCountries, visitedParts } from "./borders";
import { countryLabel, type TravelStats } from "./stats";

/**
 * The shareable stats card: a flat map with visited countries shaded, plus the
 * headline numbers. Drawn as SVG so the same code makes the PNG in the browser
 * (Share image) and at deploy time (scripts/stats-image.ts).
 */

export const SHARE_SIZES = {
    post: { width: 1080, height: 1350, label: "Post", hint: "4:5 · Instagram feed" },
    story: { width: 1080, height: 1920, label: "Story", hint: "9:16 · stories" },
    wide: { width: 1200, height: 630, label: "Link preview", hint: "1.91:1 · link previews" },
} as const;
export type ShareSize = keyof typeof SHARE_SIZES;

export const SHARE_FONT = "Bricolage Grotesque";

const C = {
    bg: "#0b1220",
    land: "#1f2a40",
    visited: "#6cb6ff",
    text: "#f2f5fa",
    muted: "#8ea0bf",
    soft: "#c9d4e6",
};

export interface ShareInput {
    countries: CountryFeature[];
    /** Every stop: shades the countries and marks the places (small countries vanish at this scale otherwise). */
    stops: { lat: number; lng: number; country?: string }[];
    stats: TravelStats;
    size: ShareSize;
    /** Shown at the bottom, e.g. "thedylone.github.io/travel-history". */
    url: string;
    /** A data: URL of the font, embedded so a browser can rasterise the SVG with it. */
    fontDataUrl?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FAMILY = `'${SHARE_FONT}', 'Helvetica Neue', Arial, sans-serif`;

const text = (x: number, y: number, size: number, content: string, attrs: Record<string, string | number> = {}) => {
    const a = Object.entries({ "font-size": size, fill: C.text, ...attrs }).map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ");
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${a}>${content}</text>`;
};
const label = (x: number, y: number, size: number, content: string, anchor = "start") =>
    text(x, y, size, esc(content.toUpperCase()), { fill: C.muted, "font-weight": 600, "letter-spacing": size * 0.18, "text-anchor": anchor });

/** Rough line wrapping (SVG has none); the width estimate errs wide so lines don't overflow. */
const wrap = (items: string[], fontSize: number, maxWidth: number, maxLines: number, sep = "  ·  ") => {
    const charW = fontSize * 0.56;
    const fits = (s: string) => s.length * charW <= maxWidth;
    const lines: string[] = [];
    let line = "";
    for (const [i, item] of items.entries()) {
        const next = line ? line + sep + item : item;
        if (!line || fits(next)) {
            line = next;
            continue;
        }
        if (lines.length === maxLines - 1) {
            // Last line: drop names until "+N more" fits after them.
            const kept = line.split(sep);
            let rest = items.length - i;
            while (kept.length > 1 && !fits([...kept, `+${rest} more`].join(sep))) {
                kept.pop();
                rest++;
            }
            lines.push([...kept, `+${rest} more`].join(sep));
            return lines;
        }
        lines.push(line);
        line = item;
    }
    if (line) lines.push(line);
    return lines;
};

interface MapGeometry {
    parts: CountryPart[];
    visited: Set<string>;
    collection: FeatureCollection;
    /** Height / width of the map once fitted. */
    aspect: number;
}

const mapGeometry = (input: ShareInput): MapGeometry => {
    // Antarctica takes a lot of room and nobody's counting it.
    const parts = splitCountries(input.countries.filter((c) => c.properties.name !== "Antarctica"));
    const collection: FeatureCollection = { type: "FeatureCollection", features: parts };
    const probe = geoPath(geoEqualEarth().fitWidth(1000, collection));
    const [[x0, y0], [x1, y1]] = probe.bounds(collection);
    return { parts, visited: visitedParts(parts, input.stops), collection, aspect: (y1 - y0) / (x1 - x0) };
};

/** The map, fitted into the box [x, y, width, height]. */
const mapLayer = (input: ShareInput, geo: MapGeometry, x: number, y: number, width: number, height: number) => {
    const projection = geoEqualEarth().fitExtent([[x, y], [x + width, y + height]], geo.collection);
    const path = geoPath(projection).digits(1);
    const shapes = (visited: boolean) =>
        geo.parts
            .filter((p) => geo.visited.has(p.properties.id) === visited)
            .map((p) => path(p))
            .filter(Boolean)
            .map((d) => `<path d="${d}"/>`)
            .join("");
    const dots = input.stops
        .map((s) => projection([s.lng, s.lat]))
        .filter((xy): xy is [number, number] => !!xy)
        .map(([cx, cy]) => `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(width / 320).toFixed(1)}"/>`)
        .join("");
    return (
        `<g stroke="${C.bg}" stroke-width="0.8" stroke-linejoin="round">` +
        `<g fill="${C.land}">${shapes(false)}</g><g fill="${C.visited}">${shapes(true)}</g></g>` +
        `<g fill="#fff" stroke="${C.bg}" stroke-width="1">${dots}</g>`
    );
};

const years = (s: TravelStats) =>
    s.firstYear === undefined ? "" : s.firstYear === s.lastYear ? String(s.firstYear) : `${s.firstYear}–${s.lastYear}`;

const numbers = (s: TravelStats): [string, string][] => [
    [s.trips.toLocaleString("en-GB"), s.trips === 1 ? "trip" : "trips"],
    [s.places.toLocaleString("en-GB"), s.places === 1 ? "place" : "places"],
    [s.days.toLocaleString("en-GB"), s.days === 1 ? "day away" : "days away"],
    [Math.round(s.km).toLocaleString("en-GB"), "km travelled"],
];

const headline = (x: number, y: number, s: TravelStats, big: number) =>
    `<text x="${x}" y="${y.toFixed(1)}" fill="${C.text}">` +
    `<tspan font-size="${big}" font-weight="800" letter-spacing="${-big * 0.02}">${s.countries.length}</tspan>` +
    `<tspan font-size="${big * 0.36}" font-weight="500" dx="${big * 0.12}">${s.countries.length === 1 ? "country" : "countries"}</tspan></text>`;

const portrait = (input: ShareInput, W: number, H: number) => {
    const s = input.stats;
    const P = 80;
    const geo = mapGeometry(input);
    const story = H / W > 1.5;
    const big = story ? 220 : 150;
    const listSize = story ? 30 : 27;
    const lineH = listSize * 1.45;
    const lines = wrap(s.countries.map(countryLabel), listSize, W - 2 * P, story ? 6 : 3);
    const rowH = story ? 140 : 122;

    // Vertical budget, top to bottom. The map takes what's left (up to full width).
    const header = 120;
    const headlineH = big * 0.95;
    const gap = story ? 110 : 44;
    const statsH = 2 * rowH;
    const listH = lines.length * lineH;
    const footer = H - 80;
    const fixed = headlineH + statsH + listH + gap * 4;
    const room = footer - 40 - (header + 30) - fixed;
    const mapW = Math.min(W - 2 * P, room / geo.aspect);
    const mapH = mapW * geo.aspect;
    // Centre the whole block between header and footer.
    let y = header + 30 + Math.max(0, (room - mapH) / 2);

    const parts = [label(P, header, 26, "Travel history"), label(W - P, header, 26, years(s), "end")];
    y += headlineH;
    parts.push(headline(P, y, s, big));
    y += gap;
    parts.push(mapLayer(input, geo, (W - mapW) / 2, y, mapW, mapH));
    y += mapH + gap + 70;
    numbers(s).forEach(([value, name], i) => {
        const x = i % 2 ? W / 2 + 20 : P;
        const row = y + Math.floor(i / 2) * rowH;
        parts.push(text(x, row, story ? 84 : 76, esc(value), { "font-weight": 700, "letter-spacing": -1.5 }));
        parts.push(label(x, row + 40, 23, name));
    });
    y += statsH - 70 + gap + 30;
    lines.forEach((line, i) => parts.push(text(P, y + i * lineH, listSize, esc(line), { fill: C.soft, "font-weight": 500 })));
    parts.push(text(P, footer, 26, esc(input.url), { fill: C.muted, "font-weight": 500 }));
    return parts.join("");
};

const wide = (input: ShareInput, H: number) => {
    const s = input.stats;
    const P = 56;
    const geo = mapGeometry(input);
    const mapW = Math.min(700 - P, (H - 2 * P) / geo.aspect);
    const mapH = mapW * geo.aspect;
    const parts = [mapLayer(input, geo, P, (H - mapH) / 2, mapW, mapH)];
    const x = P + mapW + 56;
    parts.push(label(x, P + 30, 20, `Travel history · ${years(s)}`));
    parts.push(headline(x, P + 170, s, 128));
    numbers(s).forEach(([value, name], i) => {
        const cx = i % 2 ? x + 190 : x;
        const row = P + 290 + Math.floor(i / 2) * 110;
        parts.push(text(cx, row, 54, esc(value), { "font-weight": 700, "letter-spacing": -1 }));
        parts.push(label(cx, row + 32, 17, name));
    });
    parts.push(text(x, H - P, 20, esc(input.url), { fill: C.muted, "font-weight": 500 }));
    return parts.join("");
};

export const renderShareSvg = (input: ShareInput): string => {
    const { width: W, height: H } = SHARE_SIZES[input.size];
    const font = input.fontDataUrl
        ? `<style>@font-face{font-family:'${SHARE_FONT}';src:url(${input.fontDataUrl}) format('truetype');font-weight:200 800}</style>`
        : "";
    const body = input.size === "wide" ? wide(input, H) : portrait(input, W, H);
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">` +
        `${font}<rect width="${W}" height="${H}" fill="${C.bg}"/>${body}</svg>`
    );
};
