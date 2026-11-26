// A shared trip's link-preview picture: its title, dates and places, and the route through its
// places on a flat map of the countries around them, on the site's paper card. Drawn on the phone (the server's free plan hasn't the time to
// draw it) when the trip is shared and whenever what it shows changes, then sent to the server.
import { geoMercator, geoPath } from "d3-geo";
import { type CountryFeature, loadCountries } from "../lib/borders";
import { svgToImage } from "../lib/rasterize";
import type { Plan } from "./plan";
import { dateRange, list, placeNames } from "./summary";

export const PICTURE = { width: 1200, height: 630 };

const C = { bg: "#f8f3e9", sea: "#efe7d9", land: "#dccfb8", accent: "#c4674a", text: "#3d3630", muted: "#776b5d" };
/** The map behind the route: paper land on a dusty blue sea. */
const M = { sea: "#d5dfdc", land: "#f6f0e4", border: "#d3c5ad", halo: "#fbf8f1" };
const FONT = "Bricolage Grotesque";
const FAMILY = `'${FONT}', 'Helvetica Neue', Arial, sans-serif`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Roughly how wide the font's bold letters are, per point of size. */
const CHAR_WIDTH = 0.5;

/**
 * The title in at most three lines of `width`, as big as fits: [font size, lines]. Text can't be
 * measured in an SVG, so letters are taken as an average width.
 */
export const fitTitle = (title: string, width: number): [number, string[]] => {
    const wrap = (size: number) => {
        const max = Math.max(1, Math.floor(width / (size * CHAR_WIDTH)));
        const lines: string[] = [];
        for (const word of title.split(/\s+/).filter(Boolean)) {
            for (let w = word; w; w = w.slice(max)) {
                const piece = w.slice(0, max);
                const last = lines.at(-1);
                if (last !== undefined && piece === w && last.length + 1 + piece.length <= max) lines[lines.length - 1] = `${last} ${piece}`;
                else lines.push(piece);
            }
        }
        return lines;
    };
    for (const size of [104, 92, 80, 70, 62, 54]) {
        const lines = wrap(size);
        if (lines.length <= (size > 80 ? 2 : 3)) return [size, lines];
    }
    const lines = wrap(54);
    if (lines.length <= 3) return [54, lines];
    // Too long even small: cut the third line short, at a word if it can.
    const third = lines[2].length > 4 && lines[2].includes(" ") ? lines[2].slice(0, lines[2].lastIndexOf(" ")) : lines[2].slice(0, -1);
    return [54, [lines[0], lines[1], `${third}…`]];
};

/** The main stops with a place on the map, in order. */
const stops = (p: Plan) =>
    p.days
        .flatMap((d) => d.places)
        .filter((x) => !x.side && x.lat !== undefined && x.lng !== undefined)
        .map((x) => ({ lat: x.lat!, lng: x.lng!, name: x.name.trim() || x.place.split(",")[0].trim() }));

type Stop = { lat: number; lng: number; name: string };

/** Web Mercator, in parts of the world's width: what map tiles use, so a map lines up with them. */
const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
    const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/**
 * The view that fits the stops into [x, y, w, h]: `scale` is the world's width in pixels, centred
 * on (cx, cy) in Mercator units, which lands at (ox, oy).
 */
export const tripView = (points: Stop[], x: number, y: number, w: number, h: number) => {
    const lat0 = points.reduce((a, s) => a + s.lat, 0) / points.length;
    const xs = points.map((s) => mercX(s.lng));
    const ys = points.map((s) => mercY(s.lat));
    // At least half a degree across, so a city break doesn't zoom in on one street.
    const min = 0.5 / 360 / Math.cos((lat0 * Math.PI) / 180);
    const scale = Math.min(w / Math.max(Math.max(...xs) - Math.min(...xs), min), h / Math.max(Math.max(...ys) - Math.min(...ys), min));
    const view = { scale, cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, ox: x + w / 2, oy: y + h / 2 };
    const at = (lng: number, lat: number): [number, number] => [view.ox + (mercX(lng) - view.cx) * scale, view.oy + (mercY(lat) - view.cy) * scale];
    return { ...view, at };
};
type TripView = ReturnType<typeof tripView>;

/** The countries in the view, as land on sea, filling [x, y, w, h]. */
export const flatMap = (countries: CountryFeature[], v: TripView, x: number, y: number, w: number, h: number) => {
    const projection = geoMercator()
        .scale(v.scale / (2 * Math.PI))
        .translate([v.ox + v.scale * (0.5 - v.cx), v.oy + v.scale * (0.5 - v.cy)])
        .clipExtent([[x - 4, y - 4], [x + w + 4, y + h + 4]]);
    const path = geoPath(projection).digits(1);
    const land = countries.map((c) => path(c) ?? "").join("");
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${M.sea}"/>` + (land ? `<path d="${land}" fill="${M.land}" stroke="${M.border}" stroke-width="1.5" stroke-linejoin="round"/>` : "");
};

/** The route through the stops, in the view. `halo` rings the dots and words so they stand off the map. */
const route = (points: Stop[], v: TripView, box: { x: number; w: number }, halo: string) => {
    const at = points.map((s) => v.at(s.lng, s.lat).map((q) => q.toFixed(1)).join(","));
    const line = at.length > 1 ? `<polyline points="${at.join(" ")}" fill="none" stroke="${C.accent}" stroke-width="5" stroke-dasharray="2 12" stroke-linecap="round" stroke-linejoin="round"/>` : "";
    const dots = at
        .map((q, i) => {
            const [px, py] = q.split(",");
            const r = i === 0 ? 14 : 10;
            return `<circle cx="${px}" cy="${py}" r="${r}" fill="${i === 0 ? C.accent : C.text}" stroke="${halo}" stroke-width="5"/>`;
        })
        .join("");
    // Where it starts and ends, by name.
    const label = (i: number) => {
        const [px, py] = at[i].split(",").map(Number);
        const name = points[i].name.length > 18 ? `${points[i].name.slice(0, 17)}…` : points[i].name;
        // Under the dot (over it for the start, so two close ends don't overlap), kept inside the card.
        const half = name.length * 22 * 0.27;
        const lx = Math.min(Math.max(px, box.x + 30 + half), box.x + box.w - 30 - half);
        const ly = i === 0 ? py - 28 : py + 44;
        const attrs = `font-size="22" font-weight="${i === 0 ? 700 : 600}" fill="${i === 0 ? C.accent : C.text}" text-anchor="middle" paint-order="stroke" stroke="${halo}" stroke-width="6" stroke-linejoin="round"`;
        return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" ${attrs}>${esc(name)}</text>`;
    };
    const labels = at.length > 1 && points.at(-1)!.name === points[0].name ? label(0) : [0, at.length - 1].filter((i, k, a) => a.indexOf(i) === k).map(label).join("");
    return line + dots + labels;
};

/** A plan's days on a card, for trips with nothing on the map yet. */
const days = (x: number, y: number, w: number, count: number) => {
    const rows = Math.min(3, Math.max(1, count));
    const rowH = 74;
    const top = y - (rows * rowH) / 2 + rowH / 2;
    const out = rows > 1 ? [`<line x1="${x}" y1="${top}" x2="${x}" y2="${top + (rows - 1) * rowH}" stroke="${C.accent}" stroke-width="4" stroke-dasharray="2 11" stroke-linecap="round"/>`] : [];
    for (let i = 0; i < rows; i++) {
        const ry = top + i * rowH;
        out.push(`<circle cx="${x}" cy="${ry}" r="11" fill="${C.accent}" stroke="${C.sea}" stroke-width="5"/>`);
        out.push(`<text x="${x + 34}" y="${ry - 6}" font-size="18" font-weight="600" letter-spacing="3.2" fill="${C.muted}">DAY ${i + 1}</text>`);
        out.push(`<rect x="${x + 34}" y="${ry + 8}" width="${(w * [0.7, 0.5, 0.6][i]).toFixed(0)}" height="12" rx="6" fill="${C.land}"/>`);
    }
    return out.join("");
};

/** The picture as an SVG. `url` is the site's short address. */
export const renderTripSvg = (
    p: Plan,
    { url = "", fontDataUrl, countries }: { url?: string; fontDataUrl?: string; countries?: CountryFeature[] } = {}
) => {
    const { width: W, height: H } = PICTURE;
    const P = 64;
    const parts: string[] = [];
    const text = (x: number, y: number, size: number, content: string, attrs = "") =>
        `<text x="${x}" y="${y.toFixed(1)}" font-size="${size}" ${attrs}>${esc(content)}</text>`;

    const dates = dateRange(p.start, p.days.length);
    parts.push(text(P, P + 30, 20, (dates || "Trip plan").toUpperCase(), `font-weight="600" letter-spacing="3.6" fill="${C.muted}"`));
    const [size, lines] = fitTitle(p.title.trim() || "A trip plan", 560);
    let y = P + 40 + size * 0.95;
    for (const line of lines) {
        parts.push(text(P, y, size, line, `font-weight="800" letter-spacing="${(-size * 0.02).toFixed(1)}" fill="${C.text}"`));
        y += size * 1.02;
    }
    const names = placeNames(p.days);
    const length = `${p.days.length} ${p.days.length === 1 ? "day" : "days"}`;
    const about = [length, names.length ? list(names, 2) : p.country].filter(Boolean).join(" · ");
    parts.push(text(P, y + 14, 28, about.length > 42 ? `${about.slice(0, 41)}…` : about, `font-weight="500" fill="${C.muted}"`));
    parts.push(text(P, H - P, 20, url ? `${url}/planner` : "Trip planner", `font-weight="500" fill="${C.muted}"`));

    // The route, on a card.
    const box = { x: 700, y: P, w: W - 700 - P, h: H - 2 * P };
    parts.push(`<rect x="${box.x + 7}" y="${box.y + 9}" width="${box.w}" height="${box.h}" rx="28" fill="${C.land}" opacity="0.6"/>`);
    const card = `x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="28"`;
    parts.push(`<rect ${card} fill="${C.sea}"/>`);
    const points = stops(p);
    if (points.length) {
        const v = tripView(points, box.x + 60, box.y + 60, box.w - 120, box.h - 120);
        // The map, cut to the card's rounded corners, with the card's edge over it.
        const map = countries?.length ? flatMap(countries, v, box.x, box.y, box.w, box.h) : "";
        if (map) parts.push(`<clipPath id="card"><rect ${card}/></clipPath><g clip-path="url(#card)">${map}</g>`);
        parts.push(`<rect ${card} fill="none" stroke="${C.land}" stroke-width="2"/>`);
        parts.push(route(points, v, box, map ? M.halo : C.sea));
    } else {
        parts.push(`<rect ${card} fill="none" stroke="${C.land}" stroke-width="2"/>`);
        parts.push(days(box.x + 70, box.y + box.h / 2, box.w - 150, p.days.length));
    }

    const font = fontDataUrl ? `<style>@font-face{font-family:'${FONT}';src:url(${fontDataUrl}) format('truetype');font-weight:200 800}</style>` : "";
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">` +
        `${font}<rect width="${W}" height="${H}" fill="${C.bg}"/>${parts.join("")}</svg>`
    );
};

/** What the picture shows, in short: when it changes, the picture is drawn and sent again. */
export const pictureKey = (p: Plan) => {
    // The first item is the picture's design: changing it redraws every shared trip's picture.
    const shown = JSON.stringify(["map", p.title.trim(), p.start, p.days.length, p.country, placeNames(p.days).slice(0, 2), stops(p).map((s) => [s.name, s.lat.toFixed(3), s.lng.toFixed(3)])]);
    // FNV-1a: enough to tell pictures apart.
    let h = 0x811c9dc5;
    for (let i = 0; i < shown.length; i++) h = Math.imul(h ^ shown.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
};

/** The picture as a JPEG, on the map if the countries load (they're fetched once, ~240 kB). */
export const tripPicture = async (p: Plan, fontDataUrl?: string) => {
    const countries = stops(p).length ? await loadCountries().catch(() => undefined) : undefined;
    return svgToImage(renderTripSvg(p, { url: __SITE_URL__, fontDataUrl, countries }), PICTURE.width, PICTURE.height, "image/jpeg");
};
