import { describe, expect, it } from "vitest";
import type { Media } from "../types";
import { fromDraft, makeCover, mergeIntoPrevious, movePhoto, removable, removePhotos, toDraft } from "./draft";

const photo = (id: string): Media => ({ id, kind: "image", src: `photos/full/${id}.webp`, thumb: `photos/thumb/${id}.webp`, width: 4, height: 3 });

describe("studio draft", () => {
    const view = {
        trip: {
            title: "poland",
            from: "school",
            stops: [
                { place: "kraków", date: "2024-03-07..2024-03-08", photos: "krakow" },
                { place: "auschwitz", lat: 50.03, lng: 19.2, date: "2024-03-09", photos: ["auschwitz/1"] },
            ],
        },
        media: [[photo("krakow/1"), photo("krakow/2")], [photo("auschwitz/1")]],
    };

    it("saves an untouched trip as it was written", () => {
        expect(fromDraft(toDraft(view))).toEqual(view.trip);
    });

    it("moves a photo, writing both stops' photos as lists", () => {
        const stops = movePhoto(toDraft(view).stops, "krakow/2", 0, 1);
        expect(stops.map((s) => s.photos)).toEqual([["krakow/1"], ["auschwitz/1", "krakow/2"]]);
    });

    it("merges a stop into the one before", () => {
        const d = toDraft(view);
        d.stops[1].note = "sombre";
        const [merged, ...rest] = mergeIntoPrevious(d.stops, 1);
        expect(rest).toEqual([]);
        expect(merged).toMatchObject({ place: "kraków", date: "2024-03-07..2024-03-09", note: "sombre" });
        expect(merged.photos).toEqual(["krakow/1", "krakow/2", "auschwitz/1"]);
    });

    it("keeps a folder when only one of the merged stops has photos", () => {
        const d = toDraft(view);
        d.stops[1] = { ...d.stops[1], photos: undefined, media: [] };
        expect(mergeIntoPrevious(d.stops, 1)[0].photos).toBe("krakow");
    });

    it("makes a photo the cover by putting it first", () => {
        const stops = makeCover(toDraft(view).stops, "krakow/2", 0);
        expect(stops[0].photos).toEqual(["krakow/2", "krakow/1"]);
        expect(stops[1].photos).toEqual(["auschwitz/1"]);
        // Already the cover: the folder stays as written.
        expect(makeCover(toDraft(view).stops, "krakow/1", 0)[0].photos).toBe("krakow");
    });

    it("removes photos from whichever stops have them", () => {
        const stops = removePhotos(toDraft(view).stops, new Set(["krakow/1"]));
        expect(stops.map((s) => s.photos)).toEqual([["krakow/2"], ["auschwitz/1"]]);
    });

    it("moves nothing when the photo isn't in that stop", () => {
        const stops = toDraft(view).stops;
        expect(makeCover(stops, "auschwitz/1", 0)).toEqual(stops);
    });

    it("removes the marked photos but not a stop's cover", () => {
        const stops = toDraft(view).stops;
        const marked = { "krakow/1": { blurry: true }, "krakow/2": { similarTo: "krakow/1" }, "auschwitz/1": { blurry: true } };
        expect([...removable(stops, marked)]).toEqual(["krakow/2"]);
        expect(removable(stops, {}).size).toBe(0);
    });
});
