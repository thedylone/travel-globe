import React, { FC } from "react";
import { selectedData } from "./data";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import "./carousel.css";

const imagesPath = process.env.PUBLIC_URL + "/images/";

const DynamicCarousel: FC = () => {
    const placeholder = [
        <div key={0}>
            <img
                src={imagesPath + "piplup-goodnight.gif"}
                alt="placeholder"
            />
        </div>,
    ];
    const listToCarousel = (images: string[]) => {
        return images.map((image, index) => (
            <div key={index}>
                <img
                    src={imagesPath + image}
                    alt={image}
                />
            </div>
        ));
    };

    return (
        <Carousel
            showStatus={false}
            infiniteLoop={true}
            swipeable={true}
            emulateTouch={true}
        >
            {selectedData.images.length > 0
                ? listToCarousel(selectedData.images)
                : placeholder}
        </Carousel>
    );
};

export default DynamicCarousel;
