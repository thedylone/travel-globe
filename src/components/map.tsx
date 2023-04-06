import React, { FC, useEffect, useRef } from "react";
import Globe, { GlobeMethods } from "react-globe.gl";
import { locationsData, arcsData, setSelectedData } from "./data";

const Map: FC<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    const globeEl = useRef<GlobeMethods>();
    useEffect(() => {
        if (globeEl.current) {
            globeEl.current.controls().autoRotate = true;
            globeEl.current.controls().autoRotateSpeed = -0.1;
        }
    });
    return (
        <Globe
            ref={globeEl}
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
            // points
            pointsData={locationsData}
            pointAltitude={0.02}
            pointRadius={0.05}
            pointColor={() => "silver"}
            onPointClick={(point) => {
                props.setOpen(true);
                setSelectedData(point);
            }}
            // labels
            labelsData={locationsData}
            labelText={() => ""}
            labelSize={1}
            labelDotRadius={0.3}
            labelColor={() => "rgba(0, 0, 0, 0.5)"}
            onLabelClick={(label) => {
                props.setOpen(true);
                setSelectedData(label);
            }}
            // objects
            objectsData={locationsData}
            objectAltitude={0.02}
            onObjectClick={(object) => {
                props.setOpen(true);
                setSelectedData(object);
            }}
            // arcs
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
