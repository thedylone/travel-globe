/**
 * npm run check [-- --offline]
 * Validates data/ (trip files, bases, photos) and geocodes any new places into
 * data/places.json. Run it after editing a trip; the dev server and build do the same checks.
 */
import { nominatimSearch } from "./lib/geocode.ts";
import { loadTravelData } from "./lib/load.ts";

const offline = process.argv.includes("--offline");
const { data, errors, warnings } = await loadTravelData({
    root: process.cwd(),
    geocoder: offline ? false : nominatimSearch,
});
for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
const stops = data.trips.reduce((n, t) => n + t.stops.length, 0);
const photos = data.trips.reduce((n, t) => n + t.stops.reduce((m, s) => m + s.media.length, 0), 0);
console.log(`${data.trips.length} trips, ${stops} stops, ${photos} photos${errors.length ? `, ${errors.length} error(s)` : " - all good"}`);
process.exit(errors.length ? 1 : 0);
