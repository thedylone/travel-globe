import { createRequire } from "node:module";
import { geoContains, geoDistance } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { LatLng } from "../../src/lib/geo.ts";

type Country = Feature<Geometry, { name: string }>;

let countries: Country[] | undefined;
const load = () => {
    if (!countries) {
        // Natural Earth 1:50m, the same borders the globe draws.
        const topo = createRequire(import.meta.url)("world-atlas/countries-50m.json") as Topology;
        countries = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features;
    }
    return countries;
};

/** All country shapes (Natural Earth 1:50m), as drawn on the globe and the share image. */
export const countryFeatures = () => load();

const NEAR_COAST_RAD = (0.3 * Math.PI) / 180; // ~33 km

const vertices = (g: Geometry): Position[] =>
    g.type === "Polygon" ? g.coordinates.flat()
        : g.type === "MultiPolygon" ? g.coordinates.flat(2)
            : [];

/**
 * The country a point is in. Points just offshore (a cape, a boat trip, a coastline
 * the 1:50m borders simplify away) get the nearest country within ~30 km.
 */
export const countryAt = ({ lat, lng }: LatLng): string | undefined => {
    const p: [number, number] = [lng, lat];
    const all = load();
    const inside = all.find((c) => geoContains(c, p));
    if (inside) return inside.properties.name;
    let best: string | undefined;
    let bestD = NEAR_COAST_RAD;
    for (const c of all) {
        for (const v of vertices(c.geometry)) {
            const d = geoDistance(p, v as [number, number]);
            if (d < bestD) [best, bestD] = [c.properties.name, d];
        }
    }
    return best;
};
