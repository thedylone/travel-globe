import type { Trip } from "../types";

/**
 * One colour per trip, in date order. Hues step by the golden angle, so trips
 * next to each other in time (and usually on the map) get clearly different colours.
 */
export const tripColors = (trips: Trip[]): Map<string, string> =>
    new Map(trips.map((t, i) => [t.id, `hsl(${Math.round((i * 137.508 + 200) % 360)}, 85%, 62%)`]));

/** "hsl(200, 85%, 62%)" -> "hsla(200, 85%, 62%, 0.4)". (Comma syntax: three.js can't parse the newer form.) */
export const withAlpha = (hsl: string, alpha: number) => hsl.replace(/^hsl\((.*)\)$/, `hsla($1, ${alpha})`);

/** A CSS conic-gradient ring split evenly between colours. */
export const ringGradient = (colors: string[]) => {
    if (colors.length === 1) return colors[0];
    const step = 360 / colors.length;
    const stops = colors.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`);
    return `conic-gradient(${stops.join(", ")})`;
};
