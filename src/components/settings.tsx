import React, { FC, useCallback, useEffect } from "react";
import "./settings.css";
import { ITripsData } from "./data";

interface ISettings {
    rotate: boolean;
    day: boolean;
    res: boolean;
}

const createOption = (
    name: string,
    value: boolean,
    onChange: React.ChangeEventHandler<HTMLInputElement>
) => {
    return (
        <div className="settings__option" key={name}>
            <label htmlFor={name}>{name}</label>
            <input
                className="settings__checkbox"
                checked={value}
                type="checkbox"
                id={name}
                onChange={onChange}
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
            createOption(key, trip.enabled, (e) => {
                setTripsData({
                    ...tripsData,
                    [key]: { ...trip, enabled: e.target.checked },
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
    setTripsData({ ...tripsData });
};

const showAll = (
    tripsData: ITripsData,
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>
) => {
    for (const key in tripsData) {
        tripsData[key].enabled = true;
    }
    setTripsData({ ...tripsData });
};

const Settings: FC<{
    settings: ISettings;
    setSettings: React.Dispatch<React.SetStateAction<ISettings>>;
    tripsData: ITripsData;
    setTripsData: React.Dispatch<React.SetStateAction<ITripsData>>;
}> = (props) => {
    const keyboardHandler = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "r") {
                props.setSettings({
                    ...props.settings,
                    rotate: !props.settings.rotate,
                });
            } else if (e.key === "d") {
                props.setSettings({
                    ...props.settings,
                    day: !props.settings.day,
                });
            } else if (e.key === "h") {
                props.setSettings({
                    ...props.settings,
                    res: !props.settings.res,
                });
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
                {createOption("Rotate (R)", props.settings.rotate, (e) =>
                    props.setSettings({
                        ...props.settings,
                        rotate: e.target.checked,
                    })
                )}
                {createOption("Day (D)", props.settings.day, (e) =>
                    props.setSettings({
                        ...props.settings,
                        day: e.target.checked,
                    })
                )}
                {createOption("High Resolution (H)", props.settings.res, (e) =>
                    props.setSettings({
                        ...props.settings,
                        res: e.target.checked,
                    })
                )}
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
