import { describe, expect, it } from "vitest";
import { newPlace } from "./plan";
import { applePlace, googlePlace, googleRoute, parseCoords } from "./maps";

describe("parseCoords", () => {
    it("reads plain coordinates", () => {
        expect(parseCoords("35.0394, 135.7292")).toEqual({ name: "", lat: 35.0394, lng: 135.7292 });
        expect(parseCoords("-33.8568 151.2153")).toEqual({ name: "", lat: -33.8568, lng: 151.2153 });
    });
    it("keeps a name typed before them", () => {
        expect(parseCoords("Mountain hut 46.5, 8.02")).toEqual({ name: "Mountain hut", lat: 46.5, lng: 8.02 });
    });
    it("reads N/S/E/W", () => {
        expect(parseCoords("40.7° N, 74.0° W")).toEqual({ name: "", lat: 40.7, lng: -74 });
    });
    it("reads a Google Maps link", () => {
        expect(parseCoords("https://www.google.com/maps/place/X/@51.5007,-0.1246,17z")).toEqual({ name: "", lat: 51.5007, lng: -0.1246 });
    });
    it("leaves names and out-of-range numbers alone", () => {
        expect(parseCoords("Kyoto")).toBeUndefined();
        expect(parseCoords("Route 66 2")).toBeUndefined();
        expect(parseCoords("95.1, 10.2")).toBeUndefined();
    });
});

describe("maps links", () => {
    const a = newPlace({ place: "Tower Bridge", lat: 51.5055, lng: -0.0754 });
    const b = newPlace({ place: "Borough Market", address: "London" });
    const c = newPlace({ place: "Big Ben", lat: 51.5007, lng: -0.1246 });
    it("opens a place by its coordinates, or its name", () => {
        expect(googlePlace(a)).toBe("https://www.google.com/maps/search/?api=1&query=51.5055%2C-0.0754");
        expect(googlePlace(b)).toContain("query=Borough%20Market%2C%20London");
        expect(applePlace(a)).toBe("https://maps.apple.com/?q=Tower+Bridge&ll=51.5055%2C-0.0754");
    });
    it("routes through a day's places in order", () => {
        const url = new URL(googleRoute([a, b, c])!);
        expect(url.searchParams.get("origin")).toBe("51.5055,-0.0754");
        expect(url.searchParams.get("waypoints")).toBe("Borough Market, London");
        expect(url.searchParams.get("destination")).toBe("51.5007,-0.1246");
        expect(googleRoute([a])).toBeUndefined();
    });
});
