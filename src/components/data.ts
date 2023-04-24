import _tripsJson from "../data/trips.json";
import _specialJson from "../data/special.json";

export interface ISelectedData {
    name: string;
    date: string;
    images: string[];
}

export interface ILocationData {
    name: string;
    lat: number;
    lng: number;
    date?: string;
    type?: "home" | "school" | "work";
    images?: string[];
}

export interface IArcData {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    color?: string | string[];
}

export interface ITripsJson {
    [key: string]: {
        locations: ILocationData[];
        start?: ILocationData;
        end?: ILocationData;
    };
}

export interface ITripsData {
    [key: string]: {
        locations: ILocationData[];
        arcs: IArcData[];
        enabled: boolean;
    };
}

export interface ISpecialJson {
    home?: ILocationData;
    school?: ILocationData;
    work?: ILocationData;
}

export const selectedData: ISelectedData = { name: "", date: "", images: [] };
export const tripsData: ITripsData = {};
export const specialData: ILocationData[] = [];

export const setSelectedData = (data: Object) => {
    const merge = { ...selectedData, ...data };
    selectedData.name = merge.name;
    selectedData.date = merge.date;
    selectedData.images = merge.images;
};

const randomHsl = () => `hsla(${Math.random() * 360}, 100%, 50%, 1)`;

const createArc = (
    start: ILocationData,
    end: ILocationData,
    prevColor: string | null
) => {
    const endColor = randomHsl();
    const color = [prevColor || randomHsl(), endColor];
    prevColor = endColor;
    return {
        startLat: start.lat,
        startLng: start.lng,
        endLat: end.lat,
        endLng: end.lng,
        color: color,
    };
};

const initArcs = (tripsJson: ITripsJson) => {
    for (const key in tripsJson) {
        const trip = tripsJson[key];
        const arcs: IArcData[] = [];
        tripsData[key] = {
            locations: trip.locations,
            arcs: arcs,
            enabled: true,
        };
        let prevColor = null;
        const locations = [...trip.locations];
        if (trip.start) {
            locations.unshift(trip.start);
        }
        if (trip.end) {
            locations.push(trip.end);
        }
        for (let i = 0; i < locations.length - 1; i++) {
            const arc = createArc(locations[i], locations[i + 1], prevColor);
            arcs.push(arc);
        }
    }
};
initArcs(_tripsJson);

const importSpecialJson = (specialJson: ISpecialJson) => {
    if (specialJson.home) {
        const home = specialJson.home;
        home.type = "home";
        specialData.push(home);
    }
    if (specialJson.school) {
        const school = specialJson.school;
        school.type = "school";
        specialData.push(school);
    }
    if (specialJson.work) {
        const work = specialJson.work;
        work.type = "work";
        specialData.push(work);
    }
};
importSpecialJson(_specialJson);
