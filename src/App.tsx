import React, { useState } from "react";
import Globe from "./components/map";
import Popup from "./components/popup";
import Carousel from "./components/carousel";
import { ISelectedData } from "./components/data";

function App() {
    const [open, setOpen] = useState(false);
    const [selectedData, setSelectedData] = useState<ISelectedData>({
        name: "",
        date: "",
        images: [],
    });
    return (
        <div className="App">
            <Globe
                open={open}
                setOpen={setOpen}
                selectedData={selectedData}
                setSelectedData={setSelectedData}
            />
            <Popup open={open} setOpen={setOpen} selectedData={selectedData}>
                <Carousel selectedData={selectedData} />
            </Popup>
        </div>
    );
}

export default App;
