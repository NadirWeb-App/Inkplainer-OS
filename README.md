# ✏️ Inkplainer

**Free, open-source whiteboard animation maker that runs entirely in your browser.**

Turn images and text into hand-drawn explainer videos — no sign-up, no watermark, no cost. Upload your content, pick an animation style, hit Generate, and export as MP4 or WebM.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Support on Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B.svg?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/inkplainer)
[![Open Source](https://img.shields.io/badge/open%20source-yes-brightgreen.svg)](https://github.com/NadirWeb-App)
[![Browser Only](https://img.shields.io/badge/runs%20in-browser-orange.svg)]()
[![No Sign-up](https://img.shields.io/badge/no%20sign--up-required-lightgrey.svg)]()

---

## Features

- **Multiple animation styles** — Chunk Jump, Scanner, Contour, Outline Chunks, plus 7 subject-aware Specialized styles (Human, Animal, Portrait, Vehicle, Building, Landscape, Spiral)
- **Advanced drawing control** — 5 stroke styles, 4 outline detection algorithms, 3 coloring styles, and 6 image reveal animations
- **Layer system** — stack images and text layers, set animation order, animate them in sequence or in parallel
- **Slicer tool** — cut any image into regions using Grid, Rectangle, or Freehand mode; each region becomes its own independently animated layer
- **Text layers** — place styled text directly on the canvas with font picker, size, bold/italic, alignment, line-height, letter spacing, and color controls
- **Export as MP4 or WebM** — record and download at 720p, 1080p, or 1440p
- **Export final frame as PNG** — grab a still of the finished animation in one click
- **Auto-save projects** — every change is saved to your browser automatically
- **Private by design** — no accounts, no analytics, no tracking; all processing happens locally on your device

---

## Getting Started

### Run locally

```bash
# Clone the repo
git clone https://github.com/NadirWeb-App/Inkplainer-OS.git
cd inkplainer

# Serve with any static server (recommended)
npx serve .
# or
python3 -m http.server 8080
```

Then open the serving local (e.g.,`http://localhost:8080`) in your preferred browser.

A local static server is required (rather than opening `index.html` directly) due to browser CORS and Canvas security policies when processing images.

> **Important (Hosting, HTTPS & Video Export):** Inkplainer uses the WebCodecs API for video recording and encoding. Browsers only enable WebCodecs in a **Secure Context** (HTTPS or `localhost`). If you host Inkplainer on a local network using plain HTTP (for example, `http://192.168.1.100:8080`) and access it from another device, **video export will not be available**.
>
> For most users, the easiest option is to deploy Inkplainer to a static hosting service such as Cloudflare Pages or Netlify. Since Inkplainer is a fully static application, it can be hosted for free on these platforms while automatically providing HTTPS. Example deployment: https://inkplainer.pages.dev/
>
> If you prefer to self-host on your own server, you must serve the site over HTTPS (for example, using Caddy or Nginx with a TLS certificate).
>
> **Browser Support:** Inkplainer runs entirely in the browser. Chrome and Edge are recommended and support both WebM and MP4 export. Firefox and Safari automatically fall back to WebM export when MP4 is unavailable.


### Offline / Air-Gapped Hosting
Inkplainer relies on two external resources by default:
1. **Google Fonts** (loaded via stylesheet links in `index.html`)
2. **mp4-muxer** (imported dynamically from jsDelivr CDN when exporting to MP4)

If you need to run the application in a completely offline or air-gapped environment:
- Download the Google Fonts stylesheet and font files, save them locally in the project, and update the `<link>` tags in `index.html`.
- Download the `mp4-muxer.mjs` library file, save it inside the project (e.g. as `mp4-muxer.mjs`), and update the dynamic import in `index.html` (around line 9200):
  ```javascript
  const mod = await import('./mp4-muxer.mjs');
  ```

---

## How It Works

```
Add Layers  →  Choose Settings  →  Generate  →  Export
```

### The Mental Model

Before touching any setting, it helps to understand how the app thinks about a project:

1. **Layers** are the raw material. Every image or piece of text you add becomes its own layer. Layers stack on top of each other on the canvas.
2. **Settings** tell the app how to draw each layer. You select a layer, then configure its animation style, drawing look, speed, and hand. Every setting applies to that specific layer — not the whole project. Each layer can look completely different from the others.
3. **Generate** is the moment the app reads all layers and their settings and plays the animation live on the canvas.
4. **Export** records the animation as a video file.

When Generate runs, layers animate one after another in the order you define. As each layer finishes being drawn, it gets permanently baked into the background — it stays visible while the next layer animates on top of it.

---

### Layers

**Adding images** — use the drop zone in the top section of the right panel. Drag and drop one or more files, or click to open a file browser. Supported formats: PNG, JPG, GIF, SVG. Each file becomes its own layer, automatically scaled and centered to fit the canvas.

> PNG files with transparency work best with the Drawing tab — transparent areas give the edge-detection a clean boundary to work with.

**Adding text** — switch to the Text tab in the right panel. Configure your text first, then click "Click canvas to place text" and click anywhere on the canvas to drop it. Double-click any text layer on the canvas to edit it. Press `Ctrl+Enter` to confirm or `Escape` to cancel.

Text options:

| Option | Range |
|--------|-------|
| Font | Font picker list |
| Size | 10–400px |
| Style | Bold (B) and Italic (I) toggles |
| Alignment | Left, Center, Right |
| Line height | 0.80–2.50 |
| Letter spacing | −5 to 30 |
| Color | 8 preset swatches or custom color picker |

**The Layer List** — every layer appears in the layer list at the bottom of the right panel, top to bottom in visual stacking order. Each row has a drag handle to reorder, an eye icon to toggle visibility, a thumbnail, the layer name (click once to select, click again to rename), an Order field, and a delete button.

Selecting a layer expands its individual controls: Resize (10–300%), Opacity (0–100%), Group assignment, and Position & Size (X, Y, W, H coordinates).

**Animation Order** — the Order field on each layer controls when it animates:

- Layers animate from the lowest order number to the highest
- Layers with no order number animate after all numbered layers, in visual stack order
- Layers with the same order number animate simultaneously, in parallel

| Layer | Order | When it animates |
|-------|-------|-----------------|
| Logo | 1 | First |
| Title text | 1 | Same time as Logo |
| Background | 2 | After both Logo and Title finish |
| Chart | *(blank)* | Last, after Background |

**The Slicer** — cuts one layer into multiple new layers, each with its own independent animation. Select a layer and click the Slice button above the layer list to open it. Three modes:

- **Grid** — divides the image into a uniform grid; set Columns (1–8) and Rows (1–8)
- **Rectangles** — draw custom rectangular regions on the preview canvas
- **Freehand** — draw freehand shapes on the preview to define irregular regions

All new layers inherit the original layer's settings. The original layer is removed. Animation order can then be set on each new layer independently.

**Canvas Background** — sits behind all layers and is included in the exported video. Choose from solid colors (White, Black, None, Custom) or 10 preset textures: Notebook, Graph, Cream, Chalkboard, Soft Gradient, Warm White, Blueprint, Kraft, Dark, Linen.

---

### Settings — Animation Tab

The Animation tab is the starting point for most projects. Pick a style, optionally adjust the Chunks slider, and press Generate.

**Presets** — the Presets card sits above both tabs and saves your entire settings configuration in one click. Four built-in presets:

| Preset | Style | Hand | What it produces |
|--------|-------|------|-----------------|
| Quick Reveal | Scanner | Ghost | Fast clean reveal with no visible hand |
| Sketch Artist | Contour | Hand 1 | Slow artistic contour with a charcoal stroke feel |
| Blueprint | Outline Only | Ghost | Technical drafting lines on a dark background |
| Illustrated | Illust Fill | Hand 1 | Full illustrated look with color fills |

You can also save up to 6 custom presets by clicking "+ Save current settings" at the bottom of the Presets card.

**Basic styles:**

| Style | What it does |
|-------|-------------|
| **Chunk Jump** *(Default)* | Divides canvas into tiles; each tile pops into view one at a time. Rapid and energetic. |
| **Scanner** | Image revealed in horizontal bands sweeping left to right, top to bottom. Includes a Zigzag toggle to alternate scan direction. |
| **Contour** | Two phases: first traces the visible silhouette pixel by pixel, then fills the interior with tight zigzag hatching strokes. |
| **Outline Chunks** | Detects edges, groups them into chunks, and draws each chunk one at a time. |

The **Chunks slider (6–80)** appears for Chunk Jump and Outline Chunks. Low values (6–15) = large chunks that appear quickly. High values (50–80) = many small tiles building up gradually.

**Specialized styles** — use the same reveal engine as Chunk Jump but apply a subject-aware spatial priority map so the drawing order feels natural for that type of subject:

| Style | Drawing order | Best for |
|-------|--------------|----------|
| Human | Head → shoulders → torso → legs | Full-body illustrations of people |
| Animal | Left (head) → right (tail) | Side-profile illustrations of animals |
| Portrait | Eyes/nose center → radiates outward | Close-up face portraits and headshots |
| Vehicle | Front (left) → rear (right) | Side-profile illustrations of cars, trucks, aircraft |
| Building | Foundation → roof | Architectural illustrations and building diagrams |
| Landscape | Sky/horizon → midground → foreground | Nature scenes and environmental illustrations |
| Spiral | Visual center → outward in a spiral | Circular compositions, centered logos |

> Use Basic styles for abstract graphics, charts, and icons. Use Specialized styles when the image has a clear real-world subject. A Chunks value of 30–40 is a good starting point for Specialized styles.

---

### Settings — Drawing Tab

The Drawing tab controls how the drawing *looks* — stroke character, outline detection quality, coloring fills, and image reveal. It works differently from the Animation tab in one important way: **the Drawing tab never reveals the original image during the drawing process**. Instead, it actively draws strokes, outlines, and fills from scratch — interpreting your image's edges and colors as drawing instructions. The result is a drawn version of your image, not the original.

> The Drawing tab works best with clear illustrations, cartoon-style art, and vector-style images with well-defined edges. For photographs, the Animation tab is the better choice.

**Outline Animation Modes:**

| Mode | What it does |
|------|-------------|
| **Outline Fill** | Detects and draws outlines as strokes, then optionally reveals the original image on top |
| **Illust Fill** | Like Outline Fill but adds a coloring pass after drawing — fills regions to mimic flat color illustration |
| **Outline Only** | Draws outlines on the canvas background with no image shown at any point. Pure line drawing result. No "Reveal original image" option |
| **✏ Text** | Designed for images of text — logos, title cards, handwritten words. Draws in a chosen direction |

**Stroke Style:**

| Style | Character |
|-------|----------|
| **Default 🖊** | Clean, uniform whiteboard marker line. Consistent thickness, no texture |
| **Charcoal ✏️** | Soft, thick, dusty strokes with a gritty texture — like a life-drawing study |
| **Sketch 〰** | Four faint overlapping passes along the same path — mimics exploratory strokes before committing to a line |
| **Fountain 🪶** | Variable line weight — thin on fast strokes, thick on slow curves. Calligraphic quality |
| **Blueprint 📐** | Crisp light-blue technical drafting lines. Designed to pair with the Blueprint canvas background |

**Coloring Style** (applies to the coloring pass in Illust Fill):
- **Sparse** — minimal uneven coverage, loose sketchy quality
- **Filled** *(Default)* — complete color coverage, solid and clean
- **Watercolor** — soft translucent color that bleeds slightly beyond outlines, painterly and organic

**Outline Detection Slider (0–100):**

| Range | Sensitivity | Best for |
|-------|-------------|----------|
| 0–30 | Strict | Bold, clean outlines — graphic art, cartoons, simple diagrams |
| 40–60 | Balanced | Default range — works on most images. Start here |
| 70–100 | Fine | Thin, faint, low-contrast strokes — pencil sketches, watercolor art |

**Detection Algorithm:**

| Algorithm | How it works | Best for |
|-----------|-------------|----------|
| **Classic** *(Default)* | Balanced edge pickup for dark outlines on light backgrounds | Most illustrations, logos, diagrams, photographs |
| **Adaptive** | Analyzes small regions independently for local contrast | Uneven lighting, textured backgrounds, complex photographs |
| **Morph Shell** | Erodes shapes and uses the difference as the border | Cartoons and anime with solid color regions |
| **Canny+** | Links edge fragments into continuous lines | Vector illustrations, line drawings, crisp graphic design |

**Fill Options** (visible when Outline Fill or Illust Fill is selected) — controls what happens after the drawing phase, including 6 image reveal animations (Instant, Fade, Dissolve, Wipe, Iris, Scanlines) and Outline Overlay settings (visibility, opacity, color, thickness).

**Outline Only Options** (available for Outline Only, Outline Fill, and Illust Fill modes) — two options tailored for users who try to use the Drawing tab with photographs (though the Animation tab is highly recommended for photos instead):
- **Color Region Outlines** — finds boundaries between solid-color regions rather than fine ink lines.
- **Real Image Edges** — gradient-based edge detection tuned for photographic content. Pair with a strict detection sensitivity (20–40) to reduce clutter.
> *Note:* These options are mutually exclusive. Enabling one automatically disables the other.

**Text Draw Options** (available when the **✏ Text** animation mode is selected):
- **Start Direction** — Left→Right (default), Right→Left, Top→Bottom, Bottom→Top. Controls which part of the text image animates first.
- **Fill Style** — *Reveal* (text appears progressively), *Outline* (traces letterform borders), or *Outline + Fill* (traces then fills the interior).

---

### Bottom Bar

The bottom bar contains global settings that apply to the whole animation.

**Hand Style** — the graphic that moves across the canvas during animation, selling the "someone is drawing this" illusion. Options: Ghost (no hand graphic), Hand 1, Hand 2, Hand 3, Pen. There is no functional difference between them beyond appearance.

**Speed Controls:**
- **Reveal Speed (1–100)** — how many pixels of image content are revealed per animation tick. The primary control for how long the animation takes
- **Hand Speed (1–20)** — how fast the hand graphic moves across the canvas, independently of reveal speed

> Reveal Speed is most effective in the Animation tab where it directly controls how fast the original image is uncovered. In the Drawing tab it controls the pace of stroke rendering — it still works, but the relationship is less direct.

**Canvas Size:**

| Resolution | 16:9 | 9:16 | 1:1 |
|-----------|------|------|-----|
| **720p** *(Default)* | 1280 × 720 | 720 × 1280 | 720 × 720 |
| **1080p** | 1920 × 1080 | 1080 × 1920 | 1080 × 1080 |
| **1440p** | 2560 × 1440 | 1440 × 2560 | 1440 × 1440 |

> Set your canvas size at the start of a project. Changing it after adding and positioning layers will rescale and re-center everything automatically.

---

### Generate and Export

**Generate** — pinned at the bottom of the left sidebar. Reads all layers and their settings, builds the animation from scratch, and begins playing it on the canvas. Every setting change requires a new Generate to take effect.

**Playbar** — appears below the canvas once an animation has been generated:
- **⟳ Restart** — stops and regenerates from the beginning
- **▶ / ⏸ Play / Pause** — also triggered by `Space`
- **Progress bar** — click anywhere to seek to that point
- **% display** — current position. 0% = blank canvas, 100% = final frame
- **Done badge** — green badge at 100%, confirming the animation completed

**Export Video** — click in the top bar to open the export banner.

| Format | Best for |
|--------|----------|
| **WebM** *(Recommended)* | YouTube, website embeds, most editing workflows |
| **MP4 (H.264)** | Wider compatibility outside the browser — Chrome and Edge only |

| Quality | Bitrate | Use when |
|---------|---------|----------|
| High | 8 Mbps | Final delivery, large screens, archiving |
| Medium *(Default)* | 4 Mbps | General use |
| Low | 2 Mbps | Quick sharing, drafts |

Click **Start Recording**, let the animation play through to the Done badge, and the browser downloads the file automatically.

> Do not switch browser tabs or minimize the window while recording — some browsers throttle background tabs and can drop frames or corrupt the export.

**Export checklist:**
- Canvas size and aspect ratio are correct for your target platform
- All layers are visible (eye icon on each layer)
- Animation order is set correctly
- You have watched the full animation at least once after the last Generate
- The Done badge appeared, confirming it completed without errors
- Format and quality are set appropriately

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause |
| `Delete` or `Backspace` | Remove selected layer (when not typing) |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` | Redo |
| `Ctrl/Cmd + Y` | Redo (alternative) |
| `Escape` | Cancel text placement or close text editor without saving |
| `Ctrl/Cmd + Enter` | Confirm and close the text editor |

> You cannot undo while the animation is playing. Pause or restart first.

---

## Coordinate Mapper Tool

Inkplainer ships with default hand graphics that move across the canvas during animation. The **Coordinate Mapper Tool** is a companion utility used to configure how those hand images are mapped — where the tip of each hand is, how it aligns to drawing strokes, and how it moves.

This is the tool used to set up the default hands included in the project. If you want to **replace the default hands with your own images**, you will need it.

> 📹 A tutorial video and guide for the Coordinate Mapper Tool will be added to this repo. Watch [releases](https://github.com/NadirWeb-App/inkplainer/releases) or [issues](https://github.com/NadirWeb-App/inkplainer/issues) for updates.

---

## Project Structure

```
inkplainer/
├── index.html                     # Main app UI, layout, and interaction logic
├── animations.js                  # All animation algorithms and rendering engine
├── LICENSE                        # Apache 2.0
├── README.md                      # This file
├── PRIVACY.md                     # Privacy policy
├── site.webmanifest               # Web application manifest file
├── social-preview.svg             # Social preview card image
├── Coordinate Mapper Tool V3.html # Hand coordinates configuration utility
├── images/                        # Default hand graphics used during animation
│   └── [hand image files]
└── pages/
    └── docs.html                  # Full user documentation page
```

---

## Contributing

Contributions are welcome. If you find a bug, have a feature idea, or want to improve the docs, open an issue or a pull request.

- **Bug reports** — open an [issue](https://github.com/NadirWeb-App/inkplainer/issues) with steps to reproduce
- **Feature requests** — open an issue describing what you want and why
- **Pull requests** — keep changes focused; one thing per PR

The codebase is split between `index.html` (UI and interaction) and `animations.js` (rendering engine and animation algorithms). Both files use clearly marked `═══` comment section headers — search for the section you need.

---

## Privacy

Inkplainer has no backend. Your images, text, and exported videos never leave your device. Projects are stored in your browser's IndexedDB. No analytics, no accounts, no tracking.

See [PRIVACY.md](PRIVACY.md) for the full policy.

---

## License

Apache 2.0 — see [LICENSE](LICENSE) for details.

© 2026 Nadir
