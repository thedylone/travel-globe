import React, { FC } from "react";
import { selectedData } from "./mapChart";
import { Carousel } from "react-responsive-carousel";
import "react-responsive-carousel/lib/styles/carousel.min.css";
import "./carousel.css";

export const DynamicCarousel: FC = () => {
  return (
    <Carousel showStatus={false} infiniteLoop={true} swipeable={true} emulateTouch={true}>
      {selectedData.Images.map((image, i) => (
        <div key={i}>
          <img src={`${process.env.PUBLIC_URL}/images/${image}`} alt={image} />
        </div>
      ))}
    </Carousel>
  );
};
