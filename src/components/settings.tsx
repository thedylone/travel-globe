import React, { FC } from "react";
import "./settings.css";
import { ITripsData } from "./data";

const createOption = (
    name: string,
    value: boolean,
    setValue: (value: boolean) => void
) => {
    return (
        <div className="settings__option" key={name}>
            <label htmlFor={name}>{name}</label>
            <input
                className="settings__checkbox"
                checked={value}
                type="checkbox"
                id={name}
                onChange={(e) => setValue(e.target.checked)}
            />
        </div>
    );
};

const createTripOption = (
    tripsData: ITripsData,
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>
) => {
    const options: JSX.Element[] = [];
    for (const key in tripsData) {
        const trip = tripsData[key];
        options.push(
            createOption(key, trip.enabled, (value) => {
                setTripsData({
                    ...tripsData,
                    [key]: { ...trip, enabled: value },
                });
            })
        );
    }
    return options;
};

const Settings: FC<{
    rotate: boolean;
    setRotate: React.Dispatch<React.SetStateAction<boolean>>;
    day: boolean;
    setDay: React.Dispatch<React.SetStateAction<boolean>>;
    res: boolean;
    setRes: React.Dispatch<React.SetStateAction<boolean>>;
    tripsData: ITripsData;
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>;
}> = (props) => {
    return (
        <div className="settings">
            <div className="settings__wrapper">
                <h1>Globe</h1>
                {createOption("Rotate", props.rotate, props.setRotate)}
                {createOption("Day", props.day, props.setDay)}
                {createOption("High Resolution", props.res, props.setRes)}
                <h1>Trips</h1>
                {createTripOption(props.tripsData, props.setTripsData)}
            </div>
        </div>
    );
};

export default Settings;
