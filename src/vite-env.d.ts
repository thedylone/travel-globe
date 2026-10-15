/// <reference types="vite/client" />

declare module "virtual:travel-data" {
    const data: import("./types").TravelData;
    export default data;
}

/** The site's address without the scheme, from package.json "homepage". */
declare const __SITE_URL__: string;
