import React, { FC } from "react";
import Popup from "reactjs-popup";
import "reactjs-popup/dist/index.css";
import "./popup.css";
import { selectedData } from "./data";

const ControlledPopup: FC<{
    children: React.ReactNode;
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    // const closeModal = () => props.setOpen(false);
    return (
        <Popup
            open={props.open}
            closeOnDocumentClick
            // onClose={closeModal}
            modal
        >
            <div className="modal">
                <div className="modal-header">
                    <h2>{selectedData.name}</h2>
                    <p>{selectedData.date}</p>
                </div>
                {props.children}
            </div>
        </Popup>
    );
};

export default ControlledPopup;
