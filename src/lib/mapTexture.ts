import { geoEquirectangular, geoPath } from "d3-geo";
import type { ShadedCountry } from "./borders";

export interface MapPalette {
    ocean: string;
    land: string;
    visited: string;
    /** Used for the border lines drawn over the texture. */
    border: string;
}

/**
 * Paints the map style onto one equirectangular canvas (longitude −180 at the left,
 * latitude 90 at the top: the layout globe textures use). Drawing a texture once is
 * far cheaper than building 3D shapes for every country, and it lies exactly on the
 * sphere, so nothing can poke through it.
 */
export const drawMapCanvas = (countries: ShadedCountry[], palette: MapPalette, width: number) => {
    const height = width / 2;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    const projection = geoEquirectangular().scale(width / (2 * Math.PI)).translate([width / 2, height / 2]).precision(0.2);
    const path = geoPath(projection, ctx);

    ctx.fillStyle = palette.ocean;
    ctx.fillRect(0, 0, width, height);
    for (const visited of [false, true]) {
        ctx.fillStyle = visited ? palette.visited : palette.land;
        ctx.beginPath();
        for (const c of countries) if (c.properties.visited === visited) path(c);
        ctx.fill();
    }
    // Borders are drawn as lines on the globe instead, so they stay sharp up close.
    return canvas;
};

/** The area the Layers thumbnails show (most of Europe). */
export const THUMB_BOUNDS = { west: -12, east: 40, south: 34, north: 62 };

/** Crops a lng/lat box out of an equirectangular image (the whole world, −180…180 by 90…−90) into a data URL. */
export const cropEquirect = (
    source: CanvasImageSource,
    sourceWidth: number,
    width: number,
    bounds = THUMB_BOUNDS
) => {
    const sourceHeight = sourceWidth / 2;
    const sx = ((bounds.west + 180) / 360) * sourceWidth;
    const sy = ((90 - bounds.north) / 180) * sourceHeight;
    const sw = ((bounds.east - bounds.west) / 360) * sourceWidth;
    const sh = ((bounds.north - bounds.south) / 180) * sourceHeight;
    const out = document.createElement("canvas");
    out.width = width;
    out.height = Math.round((width * sh) / sw);
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.85);
};
