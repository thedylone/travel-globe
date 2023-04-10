import React, { FC, useEffect, useRef } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import {
    ILocationData,
    locationsData,
    arcsData,
    setSelectedData,
} from "./data";

const Map: FC<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    const initTime = Date.now();
    const globeEl = useRef<GlobeMethods>();
    useEffect(() => {
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = !props.open;
            globeEl.current.controls().autoRotateSpeed = -0.05;
        }
    });
    const onClick = (data: Object) => {
        // check if after init time to prevent double click
        if (Date.now() - initTime < 500) return;
        props.setOpen(true);
        setSelectedData(data);
    };
    const location: ILocationData = {
        name: "test",
        date: "test",
        lat: 0,
        lng: 0,
        images: [],
    };
    const label = (data: Object) => {
        const merge = { ...location, ...data };
        return `<h2 style="line-height:0">
        ${merge.name}
        </h2>`;
    };
    const geometry = new THREE.SphereGeometry(.3, 32, 32);
    const material = new THREE.MeshBasicMaterial({ color: "red" });
    const sphere = new THREE.Mesh(geometry, material);
    return (
        <Globe
            ref={globeEl}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            // globeImageUrl={`${process.env.PUBLIC_URL}/images/world.png`}
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            // backgroundImageUrl={`${process.env.PUBLIC_URL}/images/stars.png`}
            // points
            pointsData={locationsData}
            pointLabel={label}
            pointAltitude={0.02}
            pointRadius={0.02}
            pointColor={() => "silver"}
            onPointClick={onClick}
            // labels
            labelsData={locationsData}
            labelText={() => ""}
            labelSize={1}
            labelDotRadius={0.1}
            labelColor={() => "rgba(0, 0, 0, 0.5)"}
            onLabelClick={onClick}
            // objects
            objectsData={locationsData}
            objectLabel={label}
            objectAltitude={0.02}
            objectThreeObject={sphere}
            onObjectClick={onClick}
            // arcs
            arcsData={arcsData}
            arcColor={"color"}
            arcDashLength={0.5}
            arcDashGap={0.5}
            arcDashAnimateTime={5000}
        />
    );
};

export default Map;
