export interface ISelectedData {
    name: string;
    date: string;
    images: string[];
}

export interface ILocationData {
    name: string;
    lat: number;
    lng: number;
    date: string;
    images: string[];
}

export interface ITripsJson {
    [key: number]: {
        locations: ILocationData[];
    };
}

export const selectedData: ISelectedData = { name: "", date: "", images: [] };
export let selectedImages: JSX.Element[] = [];
