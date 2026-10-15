import { geoEqualEarth, geoPath } from "d3-geo";
import type { FeatureCollection } from "geojson";
import { type CountryFeature, type CountryPart, splitCountries, visitedParts } from "./borders";
import { percent, type TravelStats } from "./stats";

/**
 * The shareable stats card: a flat map with visited countries shaded, the
 * headline numbers and how much of each continent you've seen. Drawn as SVG so
 * the same code makes the PNG in the browser (Share image) and at deploy time
 * (scripts/stats-image.ts).
 */

export const SHARE_SIZES = {
    post: { width: 1080, height: 1350, label: "Post", hint: "4:5 · Instagram feed" },
    story: { width: 1080, height: 1920, label: "Story", hint: "9:16 · stories" },
    wide: { width: 1200, height: 630, label: "Link preview", hint: "1.91:1 · link previews" },
} as const;
export type ShareSize = keyof typeof SHARE_SIZES;
export type ShareTheme = "dark" | "light";

export const SHARE_FONT = "Bricolage Grotesque";

const PALETTES: Record<ShareTheme, Record<"bg" | "land" | "visited" | "text" | "muted" | "dot", string>> = {
    dark: { bg: "#0b1220", land: "#1f2a40", visited: "#6cb6ff", text: "#f2f5fa", muted: "#8ea0bf", dot: "#ffffff" },
    light: { bg: "#f5f7fb", land: "#dce2ec", visited: "#2f7fd6", text: "#0e1626", muted: "#5d6a82", dot: "#0e1626" },
};

export interface ShareInput {
    countries: CountryFeature[];
    /** Every stop: shades the countries and marks the places (small countries vanish at this scale otherwise). */
    stops: { lat: number; lng: number; country?: string }[];
    stats: TravelStats;
    size: ShareSize;
    theme: ShareTheme;
    /** Shown at the bottom, e.g. "thedylone.github.io/travel-history". */
    url: string;
    /** A data: URL of the font, embedded so a browser can rasterise the SVG with it. */
    fontDataUrl?: string;
}

type Palette = (typeof PALETTES)[ShareTheme];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FAMILY = `'${SHARE_FONT}', 'Helvetica Neue', Arial, sans-serif`;
const n = (v: number) => v.toLocaleString("en-GB");

/** Small drawing helpers bound to one palette. */
const pen = (C: Palette) => {
    const text = (x: number, y: number, size: number, content: string, attrs: Record<string, string | number> = {}) => {
        const a = Object.entries({ "font-size": size, fill: C.text, ...attrs }).map(([k, v]) => `${k}="${esc(String(v))}"`).join(" ");
        return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${a}>${content}</text>`;
    };
    const label = (x: number, y: number, size: number, content: string, anchor = "start") =>
        text(x, y, size, esc(content.toUpperCase()), { fill: C.muted, "font-weight": 600, "letter-spacing": size * 0.18, "text-anchor": anchor });
    const headline = (x: number, y: number, s: TravelStats, big: number) =>
        `<text x="${x}" y="${y.toFixed(1)}" fill="${C.text}">` +
        `<tspan font-size="${big}" font-weight="800" letter-spacing="${-big * 0.02}">${s.countries.length}</tspan>` +
        `<tspan font-size="${big * 0.36}" font-weight="500" dx="${big * 0.12}">${s.countries.length === 1 ? "country" : "countries"}</tspan></text>`;
    const share = (x: number, y: number, size: number, s: TravelStats) =>
        `<text x="${x}" y="${y.toFixed(1)}" font-size="${size}" font-weight="500" fill="${C.muted}">` +
        `<tspan fill="${C.visited}" font-weight="700">${percent(s.worldShare)}</tspan> of the world's countries</text>`;
    /** One continent: name, "visited / total", and a bar. */
    const continent = (x: number, y: number, width: number, c: TravelStats["continents"][number], size: number) => {
        const barY = y + size * 0.55;
        const barH = Math.max(8, size * 0.36);
        const fill = c.total ? (c.visited / c.total) * width : 0;
        return (
            label(x, y, size * 0.8, c.name) +
            // The gap before "/" is an offset: renderers drop spaces at the edge of a tspan.
            text(x + width, y, size, `${c.visited}<tspan dx="${(size * 0.28).toFixed(1)}" fill="${C.muted}" font-weight="500">/\u00a0${c.total}</tspan>`, {
                "font-weight": 700,
                "text-anchor": "end",
            }) +
            `<rect x="${x}" y="${barY.toFixed(1)}" width="${width}" height="${barH}" rx="${barH / 2}" fill="${C.land}"/>` +
            (c.visited ? `<rect x="${x}" y="${barY.toFixed(1)}" width="${Math.max(barH, fill).toFixed(1)}" height="${barH}" rx="${barH / 2}" fill="${C.visited}"/>` : "")
        );
    };
    return { text, label, headline, share, continent };
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
    if (!parts.length) return { parts, visited: new Set(), collection, aspect: 0.45 };
    const probe = geoPath(geoEqualEarth().fitWidth(1000, collection));
    const [[x0, y0], [x1, y1]] = probe.bounds(collection);
    return { parts, visited: visitedParts(parts, input.stops), collection, aspect: (y1 - y0) / (x1 - x0) };
};

/** The map, fitted into the box [x, y, width, height]. */
const mapLayer = (input: ShareInput, C: Palette, geo: MapGeometry, x: number, y: number, width: number, height: number) => {
    if (!geo.parts.length) return "";
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
        `<g fill="${C.dot}" stroke="${C.bg}" stroke-width="1">${dots}</g>`
    );
};

const years = (s: TravelStats) =>
    s.firstYear === undefined ? "" : s.firstYear === s.lastYear ? String(s.firstYear) : `${s.firstYear}–${s.lastYear}`;

const numbers = (s: TravelStats): [string, string][] => [
    [n(s.trips), s.trips === 1 ? "trip" : "trips"],
    [n(s.places), s.places === 1 ? "place" : "places"],
    [n(s.days), s.days === 1 ? "day away" : "days away"],
    [n(Math.round(s.km)), "km travelled"],
];

const portrait = (input: ShareInput, C: Palette, W: number, H: number) => {
    const s = input.stats;
    const d = pen(C);
    const P = 80;
    const geo = mapGeometry(input);
    const story = H / W > 1.5;
    const big = story ? 210 : 150;
    // Numbers: two rows of two on a story, one row of four on a post (leaving the map more room).
    const perRow = story ? 2 : 4;
    const rowH = story ? 140 : 104;
    const valueSize = story ? 84 : 58;
    // Continents: one column of six on a story, two columns of three on a post.
    const cols = story ? 1 : 2;
    const colGap = 48;
    const colW = (W - 2 * P - (cols - 1) * colGap) / cols;
    const cSize = story ? 30 : 26;
    const cellH = story ? 82 : 72;
    const continentsH = Math.ceil(s.continents.length / cols) * cellH;

    // Vertical budget, top to bottom. The map takes what's left (up to full width).
    const header = 120;
    const headlineH = big * 0.95;
    const shareH = story ? 80 : 62;
    const gap = story ? 90 : 44;
    const statsH = (4 / perRow) * rowH;
    const footer = H - 80;
    const fixed = headlineH + shareH + statsH + continentsH + gap * 4 + (story ? 0 : 24);
    const room = footer - 40 - (header + 30) - fixed;
    const mapW = Math.max(0, Math.min(W - 2 * P, room / geo.aspect));
    const mapH = mapW * geo.aspect;
    let y = header + 30 + Math.max(0, (room - mapH) / 2);

    const parts = [d.label(P, header, 26, "Travel history"), d.label(W - P, header, 26, years(s), "end")];
    y += headlineH;
    parts.push(d.headline(P, y, s, big));
    y += shareH;
    parts.push(d.share(P, y - (story ? 16 : 12), story ? 44 : 36, s));
    y += gap;
    parts.push(mapLayer(input, C, geo, (W - mapW) / 2, y, mapW, mapH));
    y += mapH + gap + 70;
    const colStep = (W - 2 * P) / perRow;
    numbers(s).forEach(([value, name], i) => {
        const x = P + (i % perRow) * colStep;
        const row = y + Math.floor(i / perRow) * rowH;
        parts.push(d.text(x, row, valueSize, esc(value), { "font-weight": 700, "letter-spacing": -1.5 }));
        parts.push(d.label(x, row + (story ? 40 : 34), story ? 23 : 19, name));
    });
    y += statsH - 70 + gap + (story ? 10 : 34);
    s.continents.forEach((c, i) => {
        const x = P + (i % cols) * (colW + colGap);
        parts.push(d.continent(x, y + Math.floor(i / cols) * cellH, colW, c, cSize));
    });
    parts.push(d.text(P, footer, 26, esc(input.url), { fill: C.muted, "font-weight": 500 }));
    return parts.join("");
};

const wide = (input: ShareInput, C: Palette, H: number) => {
    const s = input.stats;
    const d = pen(C);
    const P = 56;
    const geo = mapGeometry(input);
    const mapW = Math.min(700 - P, (H - 2 * P) / geo.aspect);
    const mapH = mapW * geo.aspect;
    const parts = [mapLayer(input, C, geo, P, (H - mapH) / 2, mapW, mapH)];
    const x = P + mapW + 56;
    parts.push(d.label(x, P + 30, 20, `Travel history · ${years(s)}`));
    parts.push(d.headline(x, P + 150, s, 120));
    parts.push(d.share(x, P + 200, 26, s));
    numbers(s).forEach(([value, name], i) => {
        const cx = i % 2 ? x + 190 : x;
        const row = P + 295 + Math.floor(i / 2) * 105;
        parts.push(d.text(cx, row, 52, esc(value), { "font-weight": 700, "letter-spacing": -1 }));
        parts.push(d.label(cx, row + 30, 17, name));
    });
    parts.push(d.text(x, H - P, 20, esc(input.url), { fill: C.muted, "font-weight": 500 }));
    return parts.join("");
};

export const renderShareSvg = (input: ShareInput): string => {
    const { width: W, height: H } = SHARE_SIZES[input.size];
    const C = PALETTES[input.theme];
    const font = input.fontDataUrl
        ? `<style>@font-face{font-family:'${SHARE_FONT}';src:url(${input.fontDataUrl}) format('truetype');font-weight:200 800}</style>`
        : "";
    const body = input.size === "wide" ? wide(input, C, H) : portrait(input, C, W, H);
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">` +
        `${font}<rect width="${W}" height="${H}" fill="${C.bg}"/>${body}</svg>`
    );
};
