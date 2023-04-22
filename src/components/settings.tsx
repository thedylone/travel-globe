import React, { FC } from "react";
import "./settings.css";

const createOption = (
    name: string,
    value: boolean,
    setValue: (value: boolean) => void
) => {
    return (
        <div className="settings__option">
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
            {createOption("Rotate", props.rotate, props.setRotate)}
            {createOption("Day", props.day, props.setDay)}
            {createOption("High Resolution", props.res, props.setRes)}
        </div>
    );
};

export default Settings;
