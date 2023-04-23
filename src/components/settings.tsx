import React, { FC } from "react";
import "./settings.css";
import _tripsJson from "../data/trips.json";

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

const createTripOption = () => {
    const options: JSX.Element[] = [];
    for (const trip in _tripsJson) {
        options.push(createOption(trip, true, () => {}));
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
}> = (props) => {
    return (
        <div className="settings">
            <div className="settings__wrapper">
            <h1>Globe</h1>
            {createOption("Rotate", props.rotate, props.setRotate)}
            {createOption("Day", props.day, props.setDay)}
            {createOption("High Resolution", props.res, props.setRes)}
            <h1>Trips</h1>
            {createTripOption()}
            </div>
        </div>
    );
};

export default Settings;
