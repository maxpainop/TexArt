# TexArt

TexArt turns an image into scrolling colored text. I wanted the image to stay recognizable while giving people control over how the animation is built.

## What it does

- loads your own image
- lets you crop and fit it
- changes the canvas dimensions
- uses custom text, Unicode, fonts, sizes, spacing, and speed
- samples colors from the image or a custom palette
- packs characters tightly for higher detail
- records a looping GIF at crisp 1x to 4x resolution
- saves the full project as an `.mxa` file
- opens an `.mxa` file with its image and settings intact

## Using it

1. Open an image from the File menu.
2. Set the text, font, resolution, spacing, crop, and colors.
3. Press Process to build the animation.
4. Use the controls under the preview to save a GIF or `.mxa` project.

An `.mxa` file is JSON under the hood. It stores the source image inside the file with the animation settings, palette, crop, and viewport data. This lets another instance of TexArt reopen the same project without needing the original image beside it.

## Running locally

```sh
npm install
npm run tauri dev
```

`npm run tauri dev` starts Vite itself. Do not run `npm run dev` in another terminal at the same time, since both would try to use port 1420.

For a packaged build:

```sh
npm run tauri build
```

## Credits

The original idea and visual inspiration came from Ena Shinonomeh's Miku animation project.[ Ena Shinonomeh: `@ena.shinonomeh` on TikTok and Instagram. ]

This version uses its own image processing, glyph layout, painting, animation timing, palette handling, GIF rendering, and project format. The goal was to keep the visual idea while rebuilding it around user supplied images and much more control.

## License

Released under the [MIT License](LICENSE).
