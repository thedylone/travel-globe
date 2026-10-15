/// <reference types="vite/client" />

declare module "virtual:travel-data" {
    const data: import("./types").TravelData;
    export default data;
}
