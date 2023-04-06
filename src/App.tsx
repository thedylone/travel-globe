import React, { useState } from "react";
import Globe from "./components/map";
import Popup from "./components/popup";
import Carousel from "./components/carousel";

function App() {
    const [open, setOpen] = useState(false);
    return (
        <div className="App">
            <Globe open={open} setOpen={setOpen} />
            <Popup open={open} setOpen={setOpen}>
                <Carousel open={open} setOpen={setOpen} />
            </Popup>
        </div>
    );
}

export default App;
