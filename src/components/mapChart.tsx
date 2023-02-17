import React, { useState, FC } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import _historyJson from "../data/history.json";
import "./map.css";
import { ControlledPopup } from "./popup";

interface IHistoryJson {
  [key: string]: {
    Date: string;
    Images: string[];
  };
}

let displayDate: string = "";

const historyJson: IHistoryJson = _historyJson;
const geoUrl =
  "https://raw.githubusercontent.com/deldersveld/topojson/master/world-countries.json";
const mapWidth = 800;
const mapHeight = 600;

export const MapChart: FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <ComposableMap
      width={mapWidth}
      height={mapHeight}
      projectionConfig={{ scale: 160 }}
      className="map"
    >
      <ZoomableGroup
        translateExtent={[
          [0, 0],
          [mapWidth, mapHeight],
        ]}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                className={geo.properties.name in historyJson ? "marked" : ""}
                onClick={() => {
                  if (geo.properties.name in historyJson) {
                    setOpen((o) => !o);
                    displayDate = historyJson[geo.properties.name].Date;
                  }
                }}
              />
            ))
          }
        </Geographies>
      </ZoomableGroup>
      <ControlledPopup open={open} setOpen={setOpen} date={displayDate} />
    </ComposableMap>
  );
};
