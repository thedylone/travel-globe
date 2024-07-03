import React, { FC } from "react";
import Popup from "reactjs-popup";
import "reactjs-popup/dist/index.css";
import "./popup.css";
import { ISelectedData } from "./data";

const ControlledPopup: FC<{
    children: React.ReactNode;
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    selectedData: ISelectedData
}> = (props) => {
    return (
        <Popup
            open={props.open}
            closeOnDocumentClick
            onClose={() => props.setOpen(false)}
            modal
        >
            <div className="modal">
                <div className="modal-header">
                    <h2>{props.selectedData.name}</h2>
                    <p>{props.selectedData.date}</p>
                </div>
                {props.children}
            </div>
        </Popup>
    );
};

export default ControlledPopup;
