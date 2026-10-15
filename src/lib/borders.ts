import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import type { Topology } from "topojson-specification";

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
