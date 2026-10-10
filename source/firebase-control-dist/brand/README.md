# ORIN brand exports

- `orin-mark.png`: original approved in-app primary mark, unchanged.
- `png/orin-primary-approved.png`: preserved approved primary asset.
- `svg/`: scalable simplified O and app-icon master.
- `light/` and `dark/`: horizontal wordmark SVG and PNG exports.
- `monochrome/`: single-color O using `currentColor`.
- `web/`: 16, 32, 48, 180, 192 and 512px PNGs; manifest uses 192/512.
- `ios/`: common app-icon dimensions through the opaque 1024px store icon.
- `android/`: launcher density folders, separate adaptive foreground/background, adaptive XML, monochrome vector, white status icons and 512px store icon.
- `splash/`: navy splash artwork; web standalone animation preserves the original mark.

Generate with `node scripts/build-orin-icons.mjs` from the repository root. This uses vector geometry and the existing approved raster asset, not third-party logo artwork. Horizontal SVGs retain an Arial/sans-serif text reference; PNGs are rendered exports. For print masters, convert the wordmark to approved font outlines in the design handoff.

The simplified O is optimized for small sizes. Keep it distinct from the detailed approved primary mark. Dark gradients are restrained; avoid adding glow to every asset.

Native projects must install these files into their actual asset catalogs/resources and verify safe areas and launcher masks on devices. These exports alone do not configure or publish a native app. No native project is present here.
