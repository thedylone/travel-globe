import YAML from "yaml";

/** "Berlin, Hamburg & Copenhagen" -> "berlin-hamburg-copenhagen" (keeps non-Latin letters). */
export const slugify = (s: string) =>
    s
        .normalize("NFKC")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "") || "trip";

// Single-line YAML for one value (multi-line strings fall back to a quoted string).
const scalar = (v: unknown) =>
    typeof v === "string" && v.includes("\n") ? JSON.stringify(v) : YAML.stringify(v).trimEnd();

interface TripOut {
    title: string;
    from?: string;
    country?: string;
    stops: Record<string, unknown>[];
}

const STOP_KEYS = ["place", "name", "lat", "lng", "date", "note", "photos"];

/** Writes a trip file in the hand-editable layout used in data/trips/. */
export const tripYaml = (trip: TripOut, header?: string) => {
    const out: string[] = [];
    if (header) out.push(...header.trimEnd().split("\n").map((l) => `# ${l}`.trimEnd()), "");
    out.push(`title: ${scalar(trip.title)}`);
    if (trip.from) out.push(`from: ${scalar(trip.from)}`);
    if (trip.country) out.push(`country: ${scalar(trip.country)}`);
    out.push("stops:");
    for (const stop of trip.stops) {
        const keys = STOP_KEYS.filter((k) => stop[k] !== undefined);
        keys.forEach((k, i) => {
            const v = stop[k];
            const text = Array.isArray(v) ? `[${v.map(scalar).join(", ")}]` : scalar(v);
            out.push(`${i === 0 ? "  - " : "    "}${k}: ${text}`);
        });
        out.push("");
    }
    return out.join("\n").trimEnd() + "\n";
};
