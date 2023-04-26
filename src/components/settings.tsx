import React, { FC, useCallback, useEffect } from "react";
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
    return options.reverse();
};

const hideAll = (
    tripsData: ITripsData,
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>
) => {
    for (const key in tripsData) {
        tripsData[key].enabled = false;
    }
    setTripsData({...tripsData});
};

const showAll = (
    tripsData: ITripsData,
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>
) => {
    for (const key in tripsData) {
        tripsData[key].enabled = true;
    }
    setTripsData({...tripsData});
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
    const keyboardHandler = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "r") {
                props.setRotate(!props.rotate);
            } else if (e.key === "d") {
                props.setDay(!props.day);
            } else if (e.key === "h") {
                props.setRes(!props.res);
            }
        },
        [props]
    );
    useEffect(() => {
        window.addEventListener("keydown", keyboardHandler);
        return () => {
            window.removeEventListener("keydown", keyboardHandler);
        };
    }, [keyboardHandler]);

    return (
        <div className="settings">
            <div className="settings__wrapper">
                <h1>Globe</h1>
                {createOption("Rotate (R)", props.rotate, props.setRotate)}
                {createOption("Day (D)", props.day, props.setDay)}
                {createOption("High Resolution (H)", props.res, props.setRes)}
                <h1>Trips</h1>
                <div className="settings__trips--inline">
                    <span
                        className="settings__control"
                        onClick={() =>
                            hideAll(props.tripsData, props.setTripsData)
                        }
                    >
                        Hide All
                    </span>
                    <span
                        className="settings__control"
                        onClick={() =>
                            showAll(props.tripsData, props.setTripsData)
                        }
                    >
                        Show All
                    </span>
                </div>

                {createTripOption(props.tripsData, props.setTripsData)}
            </div>
        </div>
    );
};

export default Settings;
