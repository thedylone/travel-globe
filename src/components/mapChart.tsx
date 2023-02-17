import React from "react"
import { FC } from "react"
import { ComposableMap, Geographies, Geography, ZoomableGroup } from "react-simple-maps"
import historyJson from "../data/history.json"
import "./map.css"

const geoUrl =
  "https://raw.githubusercontent.com/deldersveld/topojson/master/world-countries.json"
const mapWidth = 800;
const mapHeight = 600;

export const MapChart: FC = () => {
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
          [mapWidth, mapHeight]
        ]}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                className = {geo.properties.name in historyJson ? "marked" : "" }/>
            ))
          }
        </Geographies>
      </ZoomableGroup>
    </ComposableMap>
  )
}
