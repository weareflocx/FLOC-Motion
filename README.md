# FLOC Motion

A local, internal parametric video studio. Inspired by modern parametric motion editors and public carousel examples. The WebGL layouts, shaders, example posters and editor are original implementations. Official FLOC identifiers are downloaded from the user-supplied brand file.

## FLOC brand

Source: [FLOC Brand System](https://www.figma.com/design/61GRiVYnWbglilWGDN7fUq/FLOC-Brand?node-id=3608-3624). Verified sections: palette `3608:4796`, support gray `3608:4847`, identifiers `3608:4253`.

- Black background, white typography and monochrome demo artwork. Neutral UI surfaces are functional contrast, not additional brand colors.
- Pure RGB (`#FF0000`, `#00FF00`, `#0000FF`) is reserved for meaningful accents. No sage/lime palette, colored panels or RGB gradients by default.
- The header uses the original white wordmark export (`3617:3965`). The composition uses the original white symbol SVG (`3617:4010`), without recoloring or redrawing.
- `src/brand.js` is the shared palette/asset source; the agent catalog exposes it. Uploaded carousel images remain user-controlled and are not recolored automatically.
- Geist remains the work/UI font. The abstract sample posters are original placeholders, not official FLOC graphic-system assets.

## Run

Requires Node.js 22.12+ and FFmpeg/FFprobe on PATH. Rendering uses installed Google Chrome on macOS when present. Set `HYPERFRAMES_BROWSER_PATH` to select a different working Chromium binary.

Each export stores the renderer output in `render.log` and its result or failure in `job.json`, so failures remain inspectable after a server restart.
Source video frame format is automatic: the engine keeps PNG for transparency and uses JPEG for opaque footage, independently of the final MP4 quality setting.
Carousel video frames are prepared once with FFmpeg at the project frame rate. Export textures read the prepared images, including alpha-preserving PNGs, instead of seeking browser video decoders. Preview playback still uses the original media.

Prepared export folders include `render-input.json`, local assets and the compiled scene. A separate host with the same application version, Chromium and FFmpeg can render a trusted folder with `node scripts/render-prepared.mjs <composition-folder>`. The command verifies the MP4 and writes `render-result.json`. The Mac render worker below connects the shared editor's export button to a trusted Mac.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4317**. By default, the server binds only to the loopback interface. Public hosting requires the explicit configuration below; it does not add multi-user collaboration.

```sh
npm test
npm run build
npm start
```

The bundlers use official WebAssembly builds to avoid native esbuild/Rollup binary loading issues. Dependencies are pinned in `package-lock.json`.

## Public hosting (explicit opt-in)

After building, production startup does not load Vite. Set `FLOC_PUBLIC_ORIGIN` to the exact HTTP(S) origin to bind to `0.0.0.0` and permit that host. HTTPS mutation checks use this configured origin behind the proxy. Without it, production remains loopback-only.

```sh
NODE_ENV=production PORT=8080 FLOC_PUBLIC_ORIGIN=https://floc-motion.fly.dev npm start
```

This mode deliberately has **no authentication**: anyone with access can read and edit the project, upload media and request exports. Host/Origin checks are not access control. The public editor is enabled by the owner's explicit choice, not by URL secrecy.

The Dockerfile builds the frontend and scene bundle, installs only production Node dependencies, and includes Chromium and FFmpeg. `fly.toml` selects this image, port 8080 and the public origin. Local project data is excluded from the image. These files do not deploy the app by themselves.

`FLOC_DATA_DIR` selects writable storage for the saved project, uploads and exports (default `.data/`). Fly mounts the `floc_data` volume at `/data` and stores application data in `/data/floc-motion`. The container initializes ownership of this directory, then runs Node without root privileges. Hosting uses one machine: data persists across deployments, but there is no machine redundancy or multi-user collaboration. Separate machines do not share projects or uploads; do not scale this file-backed editor horizontally. The volume must exist before deployment.

## Motion library previews

The motion library includes real six-second sample clips for each base template and all 108 catalog presets, rendered through the shared scene/export engine with local studio images. Clips play only while visible; the library provides a pause control and respects reduced-motion preferences. Base-template samples illustrate standard settings; preset samples use their actual supported recipe values, including orientation, card count and loop timing. The six-second excerpt repeats without changing the preset duration. These samples use studio images, not the current composition. Documentary reference sheets remain available in preset details. Presets with no visible cards in the sampled interval display an explicit notice rather than substituting a different configuration.

Regenerate the committed 480×270 MP4 clips and JPEG posters with `npm run previews:templates` or `npm run previews:presets`. This uses local Chrome and FFmpeg only; no project is saved or published.

## Implemented

- Circular, arc, depth and horizontal carousel templates.
- Original, liquid-wave, monochrome, duotone and chromatic-split shader presets.
- Shared ordered image collection (up to 24 images); upload, reorder and remove.
- Independently editable text layers; local image logo; layer visibility, stacking and timing; undo (20 edits).
- Solid-color, image or silent video background, with cover/contain and video offset/loop controls.
- Music upload, source offset, volume, looping and fade in/out.
- Canvas formats: 1:1 (1080×1080), 9:16 (1080×1920), 16:9 (1920×1080), 3:4 (1080×1440) and 4:3 (1440×1080); 1–30 seconds, 24/30 fps.
- Play, pause and seek; the same deterministic Three.js renderer drives preview and HyperFrames capture.
- Local MP4 export using HyperFrames, followed by an FFmpeg music mix and FFprobe verification.
- Autosave, project JSON import/download, optimistic revision checks.
- Native WebMCP tool registration and visible capability status.
- A local catalog of 108 reconstructed carousel recipes, with visual contact sheets and a validated adapter into the canonical FLOC carousel model.

## Files and privacy

### Studio typography

Text layers support Druk Wide Heavy (900), Geist Regular/Bold (400/700), and Geist Mono Medium/Bold (500/700). Geist 600/800 remain available for existing compositions. The same bundled WOFF2 registry drives the font selector, placement map, preview and self-contained MP4 jobs; fonts are not fetched from a CDN at runtime. Existing text without a font ID keeps Geist and its original weight. New demo headlines use Druk Wide, with Geist Mono for the signature; saved projects are not restyled automatically.

Geist Mono assets come from `@fontsource/geist-mono@5.3.0`; Geist assets come from the existing Fontsource package. Their OFL licenses are included in `public/fonts/`. Druk Wide was supplied by the studio; its commercial web/embedding permissions must be confirmed before publishing it.

Uploaded assets, the saved project and rendered exports live in `.data/` (git-ignored). Rendering copies only selected resources into a self-contained local job directory. No remote assets are accepted in imported projects or agent edits. HyperFrames telemetry is disabled for app renders. Uploaded SVG/code is not accepted; bundled original examples and the known official FLOC SVG are explicitly allowed.

Project JSON references local resource paths; it is **not** a portable archive. Keep `.data/assets/` when moving the installation. No project deletion or automatic asset cleanup is performed.

## Agent control / WebMCP

This implements the current **`document.modelContext.registerTool`** API, using AbortSignal-based cleanup. Tool execution uses the same runtime validation and autosave as human edits. See the [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [WebMCP specification](https://webmachinelearning.github.io/webmcp/).

WebMCP is experimental and requires a compatible browser **and** agent. The Agent tools dialog reports actual availability; an unsupported browser is not presented as connected and no browser flags are changed. Registration is feature-detected, with no fake polyfill.

Tools: `floc_get_project`, `floc_list_effects`, `floc_list_catalog`, `floc_get_preset`, `floc_apply_preset`, `floc_set_carousel`, `floc_set_shader`, `floc_update_layer`, `floc_add_text`, `floc_set_output`, `floc_seek_preview`, `floc_request_export`, `floc_get_export_status`.

The bundled catalog is a local reconstructed recipe dataset. `floc_apply_preset` maps only supported fields into the canonical project schema and reports the fields that still need native FLOC implementations. The raw catalog is available at `/catalog/presets.json`; the editor shows its visual contact sheets in the carousel inspector.

`floc_request_export` only opens the confirmation dialog. **A person must click Render MP4.** Agents cannot publish, run shell commands, import arbitrary shader code or delete resources through these tools.

Example request: “Switch to the arc template, use monochrome at 70%, add a title at the top, and show me the frame at 3 seconds.”

A local HTTP API is also available: `GET /api/catalog` (templates, catalog metadata and the raw catalog URL), `GET /api/project`, `PUT /api/project` with `{project, revision}`, `POST /api/assets?name=...` (raw file body), `POST /api/exports` with `{project}`, and `GET /api/exports/:id`. REST edits take effect in an already-open editor after reload; WebMCP actions update the live editor directly. Do not expose this unauthenticated development server to a network.

## Add a carousel or shader

1. Add its stable ID/name to `TEMPLATES` or `SHADERS` in `src/project.js`.
2. Implement the layout or GLSL branch in `src/scene.js`. Derive all visual state solely from the supplied time; never accumulate animation deltas.
3. Add any relevant controls to `src/main.jsx`, and validate new parameters in `src/project.js`.
4. Run tests and build; verify seeked frames and an MP4. Catalog selectors and WebMCP enum schemas derive from the registry automatically.

Adding implementations is a source-code change, not runtime execution of pasted code.

## Prototype boundaries

No authentication, cloud rendering, team collaboration, arbitrary plugins, 4K/GIF/WebM output, custom fonts or video cards. Browser preview depends on local codec/WebGL support. MP4 export is a local job; keep the server running. Exports are limited to one at a time and 30 seconds. This is a functional prototype, not production acceptance or a complete replica of the references.

## Verification (2026-09-30)

- 9 Node tests passed; production build passed (non-blocking bundle-size advisory).
- Chrome desktop, 768px tablet and 390px mobile layouts checked; no mobile horizontal overflow. Native dialog focus and Escape close checked.
- Local UI export/download produced H.264 1080×1080, 12 seconds / 288 frames. A separate 2-second video/audio test confirmed looping video plus offset/loop/fade soundtrack mixing; decoded frames were inspected.
- After applying the official FLOC assets and monochrome artwork, a new 2-second MP4 passed capture and frame inspection. Header wordmark and composition symbol loaded locally with their original aspect ratios.
- Simultaneous saves returned 200/409 without changing project content; foreign-Origin writes returned 403 and executable uploads 400.
- WebMCP registration/action tests pass with a test context. The user's Chrome does not expose `document.modelContext`; live native agent execution remains unverified/unavailable there.

## Original family motion engine

The local catalog drives nine original families and 24 motion variants, not 108 separately implemented animations. Orbit and Sliders use Circular and Horizontal; Showcase, Sphere, Spinner, Stack, Stickers, Twist and Wheel now have their own evaluated transforms. Depth and Arc remain available for old projects.

`src/carousel-motion.js` evaluates each card from absolute time and is consumed by the shared preview/export scene. Controls include motion variant, card count (0 uses the media count; maximum 48), aspect ratio, radius for radial families, orbit rear fade, XYZ orientation and explicit loop duration. Media repeat in their original order when more cards than images are requested. With a positive loop duration, speed selects direction or pauses at zero; with zero duration, legacy speed-based motion is preserved. Shader effects have their own time cycles and are not guaranteed to close with the motion loop.

Catalog composition settings are applied where supported. Camera perspective, surface selection, imported material semantics, shadows and depth of field remain unimplemented. Reference contact sheets are documentation, not screenshots generated by the current engine.

Card silhouettes support a corner radius of 0–100% of half the shorter edge, with circular rounded corners or a fourth-power squircle profile. The UV-space mask follows card curvature and torsion without changing the image crop. Front/back visibility is independent; hiding both intentionally hides all cards. Legacy projects default to rectangular, double-sided cards.

## Flip slider and elastic optics

Flip slider is an additional original carousel: each step holds for 60% of its interval and eases through the next card for 40%. Transition turn (0–360°) controls the Y-axis turn independently; at a full turn the settled center and side cards face forward. Elastic stretch is a separate shader, selectable on other families too: its lateral wing geometry and texture stretching follow distance from the carousel's local center, vanish at center and remain neutral at zero intensity. Both derive from absolute time/position, not accumulated mouse velocity; mouse dragging is not implemented by this feature.

## Grid positioning

Text and logo layout maps use a 6×6 grid inside a 5% safe area, plus an exact-center anchor. Click a cell, drag between cells, or use arrow keys; Escape cancels an uncommitted drag. Left/center/right element anchors align the whole bounding box, not paragraph text. Bounds use the element's measured dimensions to keep it inside the safe area when it fits; oversized elements use the available frame bounds without resizing. Existing coordinates stay unchanged until a placement is chosen, and precise positioning remains available.

The composition displays a matching non-interactive guide during map dragging only. Guides are editor-only and never exported. Placement commits ordinary validated X/Y coordinates, so preview, agent edits and exports keep the same position model.

### Preview continuity

The editor retains the active animation while preparing a replacement scene. Rapid edits are coalesced to the latest project, with one replacement loading at a time; failed loads preserve the previous preview and report an error. The displayed scene resumes at the current playhead rather than restarting. Preview rendering follows the visible frame size (up to 2× display pixel density); exports retain the full composition resolution. Replaced scenes release their media, GPU resources and WebGL context.

### Direct canvas editing

Click visible text, a logo or a carousel card to select its layer and synchronize the inspector. Drag text/logo between the existing 6×6 grid anchors. Drag a carousel card for X/Y orientation, or its visible ring for Z, using the same orientation math as the sidebar (not a new camera). Arrow keys provide grid movement or orientation; Alt adjusts Z and Shift increases the rotation step. Escape cancels the draft; pointer release commits one undoable edit. Locked layers can be selected but cannot be manipulated.

Wheel over the selected element to resize: font size for text, logo size, or card size for the carousel. A wheel burst commits one edit after 250 ms, using existing validated bounds. Ctrl+wheel is left to the browser. Outlines, guides and the rotation ring are editor-only and are never exported.

### Choreography states

Text, logos, media, carousels and 3D models support up to 32 choreography states per layer. Position, size and opacity are captured together; carousels and models also capture XYZ orientation. Select a layer and use **Choreography → Save state** at the playhead. Once states exist, changing these properties in the inspector or canvas updates the current state or records a new state at that frame. Other properties retain their ordinary editing behavior. The carousel's preset motion continues inside its animated placement.

Click a state to seek to it; drag its timeline diamond or edit **Time (s)** to move it. Arrow keys move a diamond by one frame (Shift: ten), Home/End move within its neighbors, and Delete removes it. Each destination state selects Linear, Smooth, Ease in or Ease out for its incoming transition. States move with their layer; trimming preserves states outside the visible clip. Undo and layer locks apply to state edits. Preview and export evaluate the same poses from the supplied time.

### Editable template content

Give a text, carousel, logo, media or music layer a **Template field → Field name** in the inspector to expose its content. Leave the name blank to keep that layer out of the content form. Save the composition, then choose **Use as template** in **Compositions** to fill these fields and create an independently saved composition. **Open composition** continues to edit the original saved entry.

The header's **Content** form edits only declared fields, including content in locked layers. Position, styling, timing and choreography stay intact; configuring field names still requires an unlocked layer. Carousel uploads replace only that layer's cards. Changes remain in a private preview until applied as one undoable edit; Cancel leaves the composition unchanged.

### Linked format versions

Enable **Linked formats** under Canvas to make the current ratio the master and generate assisted 1:1, 9:16 and 16:9 adaptations. The ratio buttons switch between versions; the existing 3:4 and 4:3 ratios are adapted when first selected. Each version retains its placement, size, orientation, framing, safe margins and text font, weight, width, line height, letter spacing and alignment. Content, assets, layer order, visibility, duration, media settings and carousel motion remain shared. Choreography state IDs, times, easing and opacity are shared; each format keeps its own pose coordinates and sizes.

Correct a version with the ordinary inspector and canvas controls. **Reset from master** regenerates the active adaptation from the master's current layout. Disabling Linked formats retains the active composition and removes the other layouts. These actions are undoable. Saved compositions and project JSON retain all versions; preview, agent output switching and manual MP4 export use the active version through the same scene engine.

### Layers

The layer list shows frontmost layers first. Drag a row to reorder it; the insertion line indicates its new position. Double-click a name (or use Rename / F2) to rename it, Enter to commit and Escape to cancel. Arrow buttons and Alt+Up/Down provide keyboard ordering. Text and logo layers can be duplicated above their source; background, carousel and music remain singletons, with a 20-layer project limit.

Locks persist in project JSON and prevent direct property, timing, order and removal edits. Locked layers can still be selected, hidden/shown and unlocked; the shared patch validator also protects agent edits. Locks are editing safeguards, not permissions: importing a project, Undo and composition-wide duration changes retain their normal behavior. Locking does not change rendering or export.

### Animated carousel media

Carousel cards accept local images, GIF, MP4 and WebM (75 MB per uploaded file). Mixed media share the existing ordering and templates. Videos loop silently from the carousel layer's start; pause and timeline seeking select the corresponding decoded frame. Repeated cards share a video decoder/texture for each source instead of loading a video per mesh. High-resolution videos and many simultaneous sources can increase preview cost.

GIFs retain their original file and get a local, cached VP9 WebM derivative for seekable playback, including older saved GIF cards. Conversion uses the already-required FFmpeg and preserves frame timing and alpha. Preview and export use the same media clock. Export waits for frame decoding through the renderer's `hf-seek`/`waitUntil` contract before capturing WebGL, rather than using an independent playback clock. Unsupported codecs or unreadable media report an error; upload format alone does not guarantee codec support.

### Saved composition templates

Open **Saved templates** in the header to save a complete composition snapshot with a name and up to ten searchable tags. A selected template has a real, on-demand engine preview; gallery covers are media references, not rendered composition thumbnails. Rename or retag a template without changing its saved scene. Applying a template replaces the full composition after confirmation and uses the editor's existing Undo history.

Templates persist as validated JSON files in `FLOC_DATA_DIR/templates` (the local `.data/templates` by default), separately from the autosaved canvas. Editing a composition does not overwrite a saved template: save another snapshot to retain a new version. Uploaded media are referenced in the same workspace rather than duplicated; deleting a template does not delete media or the current project. These are workspace-local snapshots, not portable media archives or cross-device sync. Fly uses its existing persistent data volume when this feature is deployed. Restart the server after adding the template API; refreshing the frontend alone does not reload backend modules.

## Mac render worker

The shared editor can delegate exports to a trusted Mac without exposing a local port. Set `FLOC_RENDER_WORKER_TOKEN` on the shared server and create `.data/render-worker/config.json` on the Mac with `{"origin":"https://floc-motion.fly.dev","token":"<same random token>"}`. Restrict that file to the current user (mode 0600). Run `node scripts/render-worker.mjs`; the worker downloads validated project media, uses the native browser GPU, renders with the pinned HyperFrames engine and uploads the verified MP4. The existing export confirmation and download button remain in place. When the Mac is offline, new exports fail immediately with an explanatory message; interrupted jobs fail after 90 seconds without a heartbeat. Only one export runs at a time. The Mac must remain awake and connected. No Runpod resources are used.

### Visual language

Background Source includes **Procedural** with a curated collection of 12 patterns. Each tile is drawn by the same renderer as the composition. Base color, pattern color, scale, intensity, speed and seed remain editable; a speed of zero freezes the pattern. Procedural animation derives from the supplied layer time, so reverse seeking and export reproduce the same image. Existing image and video backgrounds remain available.

Text layers include line height, letter spacing in em, alignment and directional wipe reveals with an adjustable duration. Typography is local to each linked format; reveal direction and timing remain shared. Previews, placement measurements and export use the same style values. These settings are saved in project JSON and validated for human and WebMCP edits. MP4 export still requires **Render MP4** confirmation.

### Visual alternatives

**Explore styles** opens three installed creative directions: Editorial, Bold and Experimental. Switch between their real previews and **Original** at the same playhead time, then choose **Apply alternative**. Comparison stays private; applying a proposal is one undoable edit through the usual autosave. Content, local media, layer timing, locks and inactive linked-format corrections are preserved.

A connected native WebMCP agent can submit 2–3 custom directions with **floc_propose_alternatives**. Read **floc_get_project** first and pass that snapshot as `base`, with each alternative's name and per-layer visual patches. Proposals use installed styles and the canonical validator; they cannot upload code, replace content or start a render. The app rejects stale proposals and changes made while another comparison is open. A person chooses which proposal to apply.
