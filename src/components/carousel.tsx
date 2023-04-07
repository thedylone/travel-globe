import React, { FC } from "react";
import { selectedData } from "./data";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";

const DynamicCarousel: FC = () => {
    const placeholder = [
        <div key={0}>
            <img
                src={`${process.env.PUBLIC_URL}/images/8.png`}
                alt="placeholder"
            />
        </div>,
    ];
    const listToCarousel = (images: string[]) => {
        return images.map((image, index) => (
            <div key={index}>
                <img
                    src={`${process.env.PUBLIC_URL}/images/${image}`}
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
