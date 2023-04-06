import React, { FC } from "react";
import Globe from "react-globe.gl";
import {
    ILocationData,
    ITripsJson,
    selectedData,
    selectedImages,
} from "./data";
import _tripsJson from "../data/trips.json";

const tripsJson: ITripsJson = _tripsJson;
const locationsData: ILocationData[] = [];
const arcsData: Object[] = [];

const randomHsl = () => `hsla(${Math.random() * 360}, 100%, 50%, 1)`;

const importJson = (tripsJson: ITripsJson) => {
    console.log("import");
    for (let i = 0; i < Object.keys(tripsJson).length; i++) {
        const trip = tripsJson[i];
        const color = [randomHsl(), randomHsl()];
        const len = trip.locations.length;
        for (let j = 0; j < len; j++) {
            const start = trip.locations[j];
            locationsData.push(start);
            if (j === len - 1) {
                break;
            }
            const end = trip.locations[j + 1];
            arcsData.push({
                startLat: start.lat,
                startLng: start.lng,
                endLat: end.lat,
                endLng: end.lng,
                color: color,
            });
        }
    }
};
importJson(tripsJson);

const clickPoint = (point: Object) => {
    const merge = { ...selectedData, ...point };
    selectedData.name = merge.name;
    selectedData.date = merge.date;
    selectedData.images = merge.images;
    selectedImages.length = 0;
    selectedImages.push(
        ...selectedData.images.map((image, i) => (
            <div key={i}>
                <img
                    src={`${process.env.PUBLIC_URL}/images/${image}`}
                    alt={image}
                />
            </div>
        ))
    );
};

const Map: FC<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    return (
        <Globe
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            pointsData={locationsData}
            onPointClick={(point) => {
                props.setOpen((o) => !o);
                clickPoint(point);
            }}
            arcsData={arcsData}
            arcColor={"color"}
            arcDashLength={1}
            arcDashGap={0.5}
            arcDashInitialGap={() => Math.random()}
            arcDashAnimateTime={5000}
        />
    );
};

export default Map;
