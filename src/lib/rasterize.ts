/** Draws an SVG string onto a canvas and returns it as a PNG. */
export const svgToPng = (svg: string, width: number, height: number) => svgToImage(svg, width, height, "image/png");

/** Draws an SVG string onto a canvas and returns it as a PNG or JPEG. */
export const svgToImage = async (svg: string, width: number, height: number, type: "image/png" | "image/jpeg"): Promise<Blob> => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
        const img = new Image(width, height);
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        return await new Promise((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image"))), type, 0.88)
        );
    } finally {
        URL.revokeObjectURL(url);
    }
};

let font: Promise<string> | undefined;

/** The share card's font as a data: URL, so it can be embedded in the SVG (images can't load fonts). */
export const shareFontDataUrl = () =>
    (font ??= fetch(`${import.meta.env.BASE_URL}fonts/BricolageGrotesque.ttf`)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`font: ${r.status}`))))
        .then(
            (blob) =>
                new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(new Blob([blob], { type: "font/ttf" }));
                })
        ));
