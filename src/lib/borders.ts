import { geoContains } from "d3-geo";
import type { Feature, FeatureCollection, Geometry, Polygon, Position } from "geojson";
import type { Topology } from "topojson-specification";
import { distanceKm } from "./geo";

export type CountryFeature = Feature<Geometry, { name: string }>;

let loading: Promise<CountryFeature[]> | undefined;

/** Natural Earth 1:50m country borders (~240 kB gzipped), fetched only when first needed. */
export const loadCountries = () =>
    (loading ??= Promise.all([import("world-atlas/countries-50m.json"), import("topojson-client")]).then(
        ([topo, { feature }]) => {
            const t = topo.default as unknown as Topology;
            return (feature(t, t.objects.countries) as FeatureCollection<Geometry, { name: string }>).features;
        }
    ));

/** Every ring of every country as a line of [lng, lat] points, for drawing borders only. */
export const borderLines = (countries: CountryFeature[]): Position[][] =>
    countries.flatMap(({ geometry: g }) =>
        g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : []
    );

/** One land mass of a country (mainland, an island, an overseas territory). */
export type CountryPart = Feature<Polygon, { name: string; id: string }>;

/** Splits countries into their separate land masses, so each can be shaded on its own. */
export const splitCountries = (countries: CountryFeature[]): CountryPart[] =>
    countries.flatMap((c) => {
        const g = c.geometry;
        const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        return polygons.map((coordinates, i): CountryPart => ({
            type: "Feature",
            properties: { name: c.properties.name, id: `${c.properties.name}#${i}` },
            geometry: { type: "Polygon", coordinates },
        }));
    });

/** A land mass counts as visited if a stop in that country is on it or this close to it. */
export const NEAR_PART_KM = 1200;

/**
 * Which land masses to shade: those of visited countries with a stop on or near
 * them. A trip to Paris shades mainland France and Corsica, but not French Guiana;
 * New York shades the US mainland, not Alaska or Hawaii.
 */
export const visitedParts = (parts: CountryPart[], stops: { lat: number; lng: number; country?: string }[]) => {
    const byCountry = new Map<string, { lat: number; lng: number }[]>();
    for (const s of stops) if (s.country) byCountry.set(s.country, [...(byCountry.get(s.country) ?? []), s]);
    const ids = new Set<string>();
    for (const part of parts) {
        const here = byCountry.get(part.properties.name);
        if (!here) continue;
        const ring = part.geometry.coordinates[0];
        const near = here.some(
            (s) =>
                geoContains(part, [s.lng, s.lat]) ||
                ring.some(([lng, lat]) => distanceKm(s, { lat, lng }) <= NEAR_PART_KM)
        );
        if (near) ids.add(part.properties.id);
    }
    return ids;
};
