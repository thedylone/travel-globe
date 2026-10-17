// The studio's editable copy of a trip file, and the edits it offers.
import type { Media } from "../types";
import type { StopInput, TripInput, TripView } from "./api";

export interface DraftStop {
    /** Stable key for React while stops are reordered. */
    key: number;
    place: string;
    name: string;
    date: string;
    /** Kept as typed until saved. */
    lat: string;
    lng: string;
    note: string;
    /** As written in the file: a folder, a list, or nothing. Becomes a list once photos are moved. */
    photos: StopInput["photos"];
    media: Media[];
}

export interface Draft {
    title: string;
    from: string;
    to: string;
    country: string;
    stops: DraftStop[];
}

let nextKey = 1;

export const emptyStop = (): DraftStop => ({
    key: nextKey++, place: "", name: "", date: "", lat: "", lng: "", note: "", photos: undefined, media: [],
});

export const emptyDraft = (): Draft => ({ title: "", from: "", to: "", country: "", stops: [emptyStop()] });

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export const toDraft = ({ trip, media }: Pick<TripView, "trip" | "media">): Draft => ({
    title: str(trip.title),
    from: str(trip.from),
    to: str(trip.to),
    country: str(trip.country),
    stops: (trip.stops ?? []).map((s, i) => ({
        ...emptyStop(),
        place: str(s.place),
        name: str(s.name),
        date: str(s.date),
        lat: str(s.lat),
        lng: str(s.lng),
        note: str(s.note),
        photos: s.photos,
        media: media[i] ?? [],
    })),
});

/** The trip to save. Empty fields are left out; the server checks the rest against the schema. */
export const fromDraft = (d: Draft): TripInput => {
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    const trip = {
        title: d.title.trim(),
        from: opt(d.from),
        to: opt(d.to),
        country: opt(d.country.toLowerCase()),
        stops: d.stops.map((s) => ({
            place: s.place.trim(),
            name: opt(s.name),
            lat: num(s.lat),
            lng: num(s.lng),
            date: s.date.trim(),
            note: s.note.trim() ? s.note.trimEnd() : undefined,
            photos: s.photos,
        })),
    };
    return JSON.parse(JSON.stringify(trip)); // drops the undefined fields
};

/** A stop with these photos, written as a list of ids (or nothing when empty). */
const withMedia = (s: DraftStop, media: Media[]): DraftStop => ({
    ...s,
    media,
    photos: media.length ? media.map((m) => m.id) : undefined,
});

/** Moves one photo to another stop (to the end of its photos). */
export const movePhoto = (stops: DraftStop[], id: string, from: number, to: number): DraftStop[] => {
    if (from === to) return stops;
    const photo = stops[from].media.find((m) => m.id === id);
    if (!photo) return stops;
    return stops.map((s, i) =>
        i === from ? withMedia(s, s.media.filter((m) => m.id !== id)) : i === to ? withMedia(s, [...s.media, photo]) : s
    );
};

export const removePhoto = (stops: DraftStop[], id: string, at: number): DraftStop[] =>
    stops.map((s, i) => (i === at ? withMedia(s, s.media.filter((m) => m.id !== id)) : s));

const ends = (date: string) => {
    const [start, end = start] = date.split("..").map((x) => x.trim());
    return { start, end };
};

/** Folds stop `i` into the one before it: dates span both, photos and notes join, the earlier place stays. */
export const mergeIntoPrevious = (stops: DraftStop[], i: number): DraftStop[] => {
    if (i < 1 || i >= stops.length) return stops;
    const [a, b] = [stops[i - 1], stops[i]];
    const days = [ends(a.date), ends(b.date)].flatMap((r) => [r.start, r.end]).filter((x) => /^\d{4}-\d\d-\d\d$/.test(x)).sort();
    const date = days.length ? (days[0] === days[days.length - 1] ? days[0] : `${days[0]}..${days[days.length - 1]}`) : a.date;
    // When only one has photos, they stay written as they were (e.g. a folder).
    const merged = !a.photos
        ? { ...a, photos: b.photos, media: b.media }
        : !b.photos
          ? a
          : withMedia(a, [...a.media, ...b.media]);
    const note = [a.note.trim(), b.note.trim()].filter(Boolean).join("\n\n");
    return [...stops.slice(0, i - 1), { ...merged, date, note }, ...stops.slice(i + 1)];
};

export const moveStop = (stops: DraftStop[], i: number, by: -1 | 1): DraftStop[] => {
    const j = i + by;
    if (j < 0 || j >= stops.length) return stops;
    const out = [...stops];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
};
