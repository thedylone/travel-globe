import React, { FC } from "react";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import "./carousel.css";
import { ISelectedData } from "./data";

const imagesPath = process.env.PUBLIC_URL + "/images/";

const DynamicCarousel: FC<{selectedData: ISelectedData}> = (props) => {
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
            {props.selectedData.images.length > 0
                ? listToCarousel(props.selectedData.images)
                : placeholder}
        </Carousel>
    );
};

export default DynamicCarousel;
