import gifenc from "gifenc";

import { CanvasAnimator, animationPattern } from "../engine/canvas-animator.js";

// render deterministic frames instead of trying to record screen timing
const MAX_GIF_FRAMES = 180;
const { GIFEncoder, applyPalette, quantize } = gifenc;

// let the interface repaint while a larger gif is being encoded
function yieldToUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function encodeLoopingGif(scene, onProgress = () => {}, scale = 1) {
    if (!scene?.grid || !scene?.settings || !scene?.viewport) {
        throw new TypeError("A processed animation scene is required.");
    }

    const exportScale = Math.max(1, Math.min(4, Math.round(Number(scale) || 1)));
    const canvas = document.createElement("canvas");
    // pixel ratio makes fillText render again at full size. no bitmap stretching.
    const animator = new CanvasAnimator(canvas, { pixelRatio: exportScale });
    const settings = {
        ...scene.settings,
        animation: {
            ...scene.settings.animation,
            enabled: false,
        },
    };
    const { patternLength, frameCount, delay } = calculateGifTiming(settings);
    const direction = settings.animation.direction === "right" ? -1 : 1;
    const encoder = GIFEncoder();
    let palette = null;

    animator.setScene(scene.grid, settings, scene.viewport);

    // sample one full text cycle so the last frame joins the first cleanly
    for (let frame = 0; frame < frameCount; frame += 1) {
        const offset = direction * patternLength * (frame / frameCount);
        animator.renderAtOffset(offset);

        const image = animator.context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height
        );

        if (!palette) {
            palette = quantize(image.data, 256, { format: "rgb565" });
        }
        const indexed = applyPalette(image.data, palette, "rgb565");

        encoder.writeFrame(indexed, canvas.width, canvas.height, {
            palette: frame === 0 ? palette : null,
            delay,
            repeat: 0,
        });

        onProgress((frame + 1) / frameCount);
        if (frame % 3 === 2) await yieldToUi();
    }

    animator.clear();
    encoder.finish();
    return new Blob([encoder.bytes()], { type: "image/gif" });
}

export function calculateGifTiming(settings) {
    const patternLength = Array.from(animationPattern(settings.charset)).length;
    const cellsPerSecond = settings.animation.speed * 60;
    if (cellsPerSecond <= 0) {
        return { patternLength, frameCount: 1, delay: 1000 };
    }
    const frameCount = Math.max(2, Math.min(MAX_GIF_FRAMES, patternLength));

    return {
        patternLength,
        frameCount,
        delay: Math.max(
            20,
            Math.round((patternLength / cellsPerSecond * 1000) / frameCount)
        ),
    };
}
