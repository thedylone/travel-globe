import React, { FC, useState, useEffect, useRef } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import * as THREE from "three";
import Settings from "./settings";
import {
    ILocationData,
    locationsData,
    arcsData,
    specialData,
    setSelectedData,
} from "./data";

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
const homeSvg = `<svg viewBox="0 0 36 36">
<path fill="currentColor" d="M14,0 C21.732,0 28,5.641 28,12.6 C28,23.963 14,36 14,36 C14,36 0,24.064 0,12.6 C0,5.641 6.268,0 14,0 Z"></path>
<circle fill="black" cx="14" cy="14" r="10"></circle>
<path fill="currentColor" d="M 14,7 l -8,8 h3 v4 a1 1 0 0 0 1 1 h2 v-4 h4 v4 h2 a1 1 0 0 0 1 -1 v-4 h3 Z">
</svg>`;
const schoolSvg = `<svg viewBox="0 0 36 36">
<path fill="currentColor" d="M14,0 C21.732,0 28,5.641 28,12.6 C28,23.963 14,36 14,36 C14,36 0,24.064 0,12.6 C0,5.641 6.268,0 14,0 Z"></path>
<circle fill="black" cx="14" cy="14" r="10"></circle>
<path fill="currentColor" d="M 14,7 l -8,5 l 8,5 l 7.2,-4.5 v5 h 0.8 v-5.5 Z"/>
<path fill="currentColor" d="M 14,18 l -4,-2.5 v 2 l 4,2.5 l 4,-2.5 v -2 Z"/>
</svg>`;
const workSvg = `<svg viewBox="0 0 36 36">
<path fill="currentColor" d="M14,0 C21.732,0 28,5.641 28,12.6 C28,23.963 14,36 14,36 C14,36 0,24.064 0,12.6 C0,5.641 6.268,0 14,0 Z"></path>
<circle fill="black" cx="14" cy="14" r="10"></circle>
<path fill="currentColor" d="M14,7 h-2 a1,1,0,0,0,-1,1 v1 h-3 a1,1,0,0,0,-1,1 v2 l7,1 l7,-1 v-2 a1,1,0,0,0,-1,-1 h-8 v-0.5 a0.5,0.5,0,0,1,0.5,-0.5 h3 a0.5,0.5,0,0,1,0.5,0.5 v0.5 h1 v-1 a1,1,0,0,0,-1,-1 z"/>
<path fill="currentColor" d="M14,14 l-7,-1 v5 a1,1,0,0,0,1,1 h12 a1,1,0,0,0,1,-1 v-5 z"/>
</svg>`;
const geometry = new THREE.SphereGeometry(0.3, 32, 32);
const material = new THREE.MeshBasicMaterial({ color: "red" });
const globeDay = "//unpkg.com/three-globe/example/img/earth-blue-marble.jpg";
// const globeDay = `${process.env.PUBLIC_URL}/images/world.png`
const globeNight = "//unpkg.com/three-globe/example/img/earth-night.jpg";
const background = "//unpkg.com/three-globe/example/img/night-sky.png";
// const background = `${process.env.PUBLIC_URL}/images/stars.png`
const bump = "//unpkg.com/three-globe/example/img/earth-topology.png";

const Map: FC<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    const initTime = Date.now();
    const [rotate, setRotate] = useState(true);
    const [day, setDay] = useState(true);
    const globeEl = useRef<GlobeMethods>();
    useEffect(() => {
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = rotate && !props.open;
            globeEl.current.controls().autoRotateSpeed = -0.05;
        }
    });
    const onClick = (data: Object) => {
        // check if after init time to prevent double click
        if (Date.now() - initTime < 500) return;
        props.setOpen(true);
        setSelectedData(data);
    };
    return (
        <>
            <Globe
                ref={globeEl}
                globeImageUrl={day ? globeDay : globeNight}
                bumpImageUrl={bump}
                backgroundImageUrl={background}
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
                objectThreeObject={new THREE.Mesh(geometry, material)}
                onObjectClick={onClick}
                // arcs
                arcsData={arcsData}
                arcColor={"color"}
                arcDashLength={0.5}
                arcDashGap={0.5}
                arcDashAnimateTime={5000}
                // html elements
                htmlElementsData={specialData}
                htmlElement={(d) => {
                    const merge = { ...location, ...d };
                    const element = document.createElement("div");
                    if (merge.type === "home") {
                        element.innerHTML = homeSvg;
                        element.style.color = "orange";
                    } else if (merge.type === "school") {
                        element.innerHTML = schoolSvg;
                        element.style.color = "cyan";
                    } else if (merge.type === "work") {
                        element.innerHTML = workSvg;
                        element.style.color = "lime";
                    }
                    element.style.opacity = "0.5";
                    element.style.width = "30px";
                    element.style.top = "-15px";
                    return element;
                }}
            />
            <Settings
                rotate={rotate}
                setRotate={setRotate}
                day={day}
                setDay={setDay}
            />
        </>
    );
};

export default Map;
