declare module "react-rating-stars-component" {
  import { FC } from "react";

  interface ReactStarsProps {
    count?: number;
    value?: number;
    edit?: boolean;
    half?: boolean;
    isHalf?: boolean;
    size?: number;
    color?: string;
    activeColor?: string;
    emptyIcon?: React.ReactNode;
    halfIcon?: React.ReactNode;
    fullIcon?: React.ReactNode;
    onChange?: (newRating: number) => void;
  }

  const ReactStars: FC<ReactStarsProps>;

  export default ReactStars;
}
