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
