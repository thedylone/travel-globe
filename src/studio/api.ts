// Talks to the studio's local API (scripts/vite-plugin-studio.ts).
import type { StopInput, TripInput } from "../../scripts/lib/schema.ts";
import type { Media } from "../types";

export type { StopInput, TripInput };

export interface TripSummary {
    id: string;
    title: string;
    start?: string;
    end?: string;
    stops: number;
    errors: number;
}

export interface TripView {
    id: string;
    /** The trip file as written; may not match the schema yet. */
    trip: Partial<TripInput> & { stops?: Partial<StopInput>[] };
    /** Each stop's photos, in order. */
    media: Media[][];
    errors: string[];
    warnings: string[];
}

export interface Base {
    key: string;
    name: string;
    icon: string;
}

export class ApiError extends Error {
    constructor(message: string, readonly body: { errors?: string[]; exists?: boolean; log?: string[] }) {
        super(message);
    }
}

const call = async <T>(method: string, path: string, body?: BodyInit | object): Promise<T> => {
    const raw = body instanceof Blob || typeof body === "string";
    const res = await fetch(`/__studio/${path}`, {
        method,
        ...(body === undefined ? {} : { body: raw ? (body as BodyInit) : JSON.stringify(body) }),
        headers: raw || body === undefined ? {} : { "Content-Type": "application/json" },
    });
    const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok) throw new ApiError(json.error ?? res.statusText, json);
    return json as T;
};

const trip = (id: string) => `trips/${encodeURIComponent(id)}`;

export const api = {
    trips: () => call<{ trips: TripSummary[] }>("GET", "trips").then((r) => r.trips),
    trip: (id: string) => call<TripView>("GET", trip(id)),
    save: (id: string, t: TripInput) => call<TripView>("PUT", trip(id), t),
    create: (t: TripInput) => call<TripView>("POST", "trips", t),
    remove: (id: string) => call<{ ok: true }>("DELETE", trip(id)),
    bases: () => call<{ bases: Base[] }>("GET", "bases").then((r) => r.bases),
    upload: (batch: string, file: File) =>
        call<{ ok: true }>("POST", `upload?${new URLSearchParams({ batch, name: file.name })}`, file),
    import: (o: { batch: string; title: string; from?: string; km: number; force: boolean }) =>
        call<{ id: string; log: string[] }>("POST", "import", o),
};

/** Where the site serves a file, e.g. a photo's thumbnail. */
export const siteUrl = (rel: string) => `${import.meta.env.BASE_URL}${rel}`;
