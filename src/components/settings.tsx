import React, { FC } from "react";
import "./settings.css";

const Settings: FC<{
    rotate: boolean;
    setRotate: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    return (
        <div className="settings">
            <div className="settings__option">
                <label htmlFor="rotate">Rotate</label>
                <input
                    className="settings__checkbox"
                    checked={props.rotate}
                    type="checkbox"
                    id="rotate"
                    onChange={(e) => props.setRotate(e.target.checked)}
                />
            </div>
        </div>
    );
};

export default Settings;
