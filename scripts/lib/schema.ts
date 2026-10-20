import { z } from "zod";

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const StopSchema = z
    .strictObject({
        /** What to look up on the map, e.g. "Kraków" or "Cape Kidnappers". Also the default label. */
        place: z.string().min(1),
        /** Label shown on the globe, if different from `place`. */
        name: z.string().min(1).optional(),
        /** Exact coordinates; skip geocoding when both are given. */
        lat: lat.optional(),
        lng: lng.optional(),
        /** "YYYY-MM-DD" or "YYYY-MM-DD..YYYY-MM-DD". */
        date: z.string(),
        /** A side trip: out from the main stop before it and back again (e.g. a day trip). */
        side: z.boolean().optional(),
        note: z.string().optional(),
        /** A folder under photos/ ("krakow") or a list of photos ("nz/2", "nz/3.jpg"). */
        photos: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .refine((s) => (s.lat === undefined) === (s.lng === undefined), {
        message: "give both lat and lng, or neither",
    });

export const TripSchema = z.strictObject({
    title: z.string().min(1),
    /** A key from data/bases.yaml ("home", "school") or a place name. */
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    /** Two-letter country code(s) to narrow geocoding, e.g. "jp" or "gb,ie". */
    country: z
        .string()
        .regex(/^[a-z]{2}(,[a-z]{2})*$/i, "use two-letter country codes, e.g. jp or gb,ie")
        .optional(),
    stops: z.array(StopSchema).min(1),
});

export const BasesSchema = z.record(
    z.string(),
    z.strictObject({
        name: z.string().min(1),
        lat,
        lng,
        icon: z.enum(["home", "school", "work"]),
    })
);

export const PhotoManifestSchema = z.record(
    z.string(),
    z.strictObject({
        kind: z.enum(["image", "video"]),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
    })
);

export type StopInput = z.infer<typeof StopSchema>;
export type TripInput = z.infer<typeof TripSchema>;
export type PhotoManifest = z.infer<typeof PhotoManifestSchema>;

export const formatIssues = (error: z.ZodError) =>
    error.issues.map((i) => {
        const path = i.path
            .map((p, n) => (typeof p === "number" ? `[${p}]` : n ? `.${String(p)}` : String(p)))
            .join("");
        return path ? `${path}: ${i.message}` : i.message;
    });
