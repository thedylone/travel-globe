import React, { FC } from "react";
import Popup from "reactjs-popup";
import "reactjs-popup/dist/index.css";
import "./popup.css";
import { selectedData } from "./mapChart";
import { DynamicCarousel } from "./carousel";

export const ControlledPopup: FC<{
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
  const closeModal = () => props.setOpen(false);
  return (
    <Popup open={props.open} closeOnDocumentClick onClose={closeModal} modal>
      <div className="modal">
        <div className="modal-header">
          <h1>{selectedData.Country}</h1>
          <h3>{selectedData.Date}</h3>
        </div>
        <DynamicCarousel />
      </div>
    </Popup>
  );
};
