import React, { FC } from 'react';
import Popup from "reactjs-popup"
import 'reactjs-popup/dist/index.css';
import './popup.css'

export const ControlledPopup: FC<{ open: boolean, setOpen: React.Dispatch<React.SetStateAction<boolean>>, date: String }> = (props) => {
    const closeModal = () => props.setOpen(false)
    return (
        <Popup open={props.open} closeOnDocumentClick onClose={closeModal} modal>
            <div className="modal">
                <div className='modal-header'>
                    <h1>Modal Title</h1>
                    <h3>{props.date}</h3>
                </div>
                
                Lorem ipsum dolor sit amet, consectetur adipisicing elit. Beatae magni
                omnis delectus nemo, maxime molestiae dolorem numquam mollitia, voluptate
                ea, accusamus excepturi deleniti ratione sapiente! Laudantium, aperiam
                doloribus. Odit, aut.
            </div>
        </Popup>
    )
}