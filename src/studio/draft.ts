// The studio's editable copy of a trip file, and the edits it offers.
import YAML from "yaml";
import type { Media } from "../types";
import type { StopInput, TripInput, TripView } from "./api";

export interface DraftStop {
    /** Stable key for React while stops are reordered. */
    key: number;
    place: string;
    name: string;
    date: string;
    /** A side trip from the main stop before it. */
    side: boolean;
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
    key: nextKey++, place: "", name: "", date: "", side: false, lat: "", lng: "", note: "", photos: undefined, media: [],
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
        side: s.side === true,
        lat: str(s.lat),
        lng: str(s.lng),
        note: str(s.note),
        photos: s.photos,
        media: media[i] ?? [],
    })),
});

/**
 * A new trip from a trip file picked in the studio, such as one exported from the trip planner.
 * Not checked here: the editor shows it, and saving checks it. Throws if it isn't a trip at all.
 */
export const draftFromFile = (text: string): Draft => {
    let trip: unknown;
    try {
        trip = YAML.parse(text);
    } catch (e) {
        throw new Error(`it isn't YAML: ${(e as Error).message}`);
    }
    if (!trip || typeof trip !== "object" || !Array.isArray((trip as { stops?: unknown }).stops)) {
        throw new Error("it isn't a trip file (it has no stops)");
    }
    const d = toDraft({ trip: trip as TripView["trip"], media: [] });
    return d.stops.length ? d : { ...d, stops: [emptyStop()] };
};

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
            side: s.side || undefined,
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

/** Puts a photo first in its stop, which makes it the one the site opens the stop's photos on. */
export const makeCover = (stops: DraftStop[], id: string, at: number): DraftStop[] =>
    stops.map((s, i) => {
        const photo = s.media.find((m) => m.id === id);
        return i === at && photo && s.media[0] !== photo ? withMedia(s, [photo, ...s.media.filter((m) => m !== photo)]) : s;
    });

/** Takes these photos out of every stop. Stops left untouched keep their photos as written. */
export const removePhotos = (stops: DraftStop[], ids: Set<string>): DraftStop[] =>
    stops.map((s) => (s.media.some((m) => ids.has(m.id)) ? withMedia(s, s.media.filter((m) => !ids.has(m.id))) : s));

/** The marked photos that "Remove all" takes. A stop's cover keeps its mark but stays: you may have picked it. */
export const removable = (stops: DraftStop[], marked: Record<string, unknown>): Set<string> =>
    new Set(stops.flatMap((s) => s.media.slice(1).filter((m) => marked[m.id]).map((m) => m.id)));

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

/** Moves stop `from` so it ends up at index `to`. */
export const moveStop = (stops: DraftStop[], from: number, to: number): DraftStop[] => {
    if (from === to || to < 0 || to >= stops.length) return stops;
    const out = [...stops];
    const [s] = out.splice(from, 1);
    out.splice(to, 0, s);
    return out;
};
