import React, { FC } from "react";
import { selectedImages } from "./data";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import "./carousel.css";

const DynamicCarousel: FC<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}> = (props) => {
    const placeholder = [
        <div key={0}>
            <img
                src={`${process.env.PUBLIC_URL}/images/8.png`}
                alt="placeholder"
            />
        </div>,
    ];
    return (
        <Carousel
            showStatus={false}
            infiniteLoop={true}
            swipeable={true}
            emulateTouch={true}
        >
            {selectedImages.length > 0 ? selectedImages : placeholder}
        </Carousel>
    );
};

export default DynamicCarousel;
