/// <reference types="vite/client" />

declare module "virtual:travel-data" {
    const data: import("./types").TravelData;
    export default data;
}

declare module "virtual:travel-bases" {
    /** data/bases.yaml: each base's key ("home") and name. */
    const bases: { key: string; name: string }[];
    export default bases;
}

/** The site's address without the scheme, from site.yaml "url"; empty if it has none. */
declare const __SITE_URL__: string;
/** From site.yaml "title". */
declare const __SITE_TITLE__: string;
