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

Requires Node.js 24+ and FFmpeg/FFprobe on PATH. Rendering uses installed Google Chrome on macOS when present. Set `HYPERFRAMES_BROWSER_PATH` to select a different working Chromium binary.

Server-local and legacy shared-worker exports store renderer output in `render.log` and result or failure metadata in `job.json`; those modes may retain `video.mp4` (server-local exports also `video.mov` or `frames.zip`) and expose an authenticated browser download. Personal renderers store only status and saved-path metadata on the editor server.
Source video frame format is automatic: the engine keeps PNG for transparency and uses JPEG for opaque footage, independently of the final MP4 quality setting.
Carousel video frames are prepared once with FFmpeg at the project frame rate. Export textures read the prepared images, including alpha-preserving PNGs, instead of seeking browser video decoders. Preview playback still uses the original media.
Export offers **MP4 · H.264** (default, AAC 320 kbps soundtrack), **MOV · ProRes 4444** (alpha plane, 16-bit PCM soundtrack) and **PNG sequence (.zip)** (8-bit `frames/frame_000001.png`… frames, plus `audio.wav` when the project has music; an uncompressed ZIP with ZIP64 offsets past 4 GB). For MOV and PNG, **Transparent background** leaves out background layers and keeps the page transparent; otherwise empty areas are white, as in MP4. Every result is verified before delivery: H.264/yuv420p or ProRes 4444 with an alpha pixel format, dimensions, frame rate, frame count and soundtrack codec; for PNG archives, every frame's name, size and PNG header are read from the ZIP. The legacy Mac render worker accepts MP4 only and rejects other formats before queuing.
Frame capture uses several HyperFrames Chrome workers (about 256 MB each): min(4, CPU cores − 1), or one on machines with 8 GB of RAM or less. Set `FLOC_RENDER_WORKERS` (1–16) to override. Each frame depends only on its supplied time, so worker count does not change the pixels: a 12-second 1920×1080 composition with a shader, a Paper post effect and a video card produced identical decoded MP4 frames and byte-identical PNG frames with 1 and 4 workers.

Prepared export folders include `render-input.json`, local assets and the compiled scene. A separate host with the same application version, Chromium and FFmpeg can render a trusted folder with `node scripts/render-prepared.mjs <composition-folder>`. The command verifies the result in the requested format and writes `render-result.json`. The Mac render worker below connects the shared editor's export button to a trusted Mac.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:4317**. By default, the server binds only to the loopback interface. Public hosting requires the explicit configuration below; accounts share the composition library, with independent saves and no simultaneous editing.

Press **Space** to play or pause the preview, and **Delete/Backspace** to remove the selected unlocked layer. These shortcuts pause while editing fields, using dialogs or manipulating the canvas. Space also works with a layer selection or playback button focused; other buttons retain native activation. Delete on a focused choreography diamond removes that state. Hold-to-repeat does not toggle playback or delete additional layers. Layer deletion supports Undo.

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

Access requires an invited account in both local and public modes. Before the first startup, run `npm run invite -- you@example.com` with the same `FLOC_DATA_DIR`, `PORT` and `FLOC_PUBLIC_ORIGIN` as the server. Open the resulting single-use link, enter that email address and choose a password of 12–128 characters. The link expires after 48 hours. This first account is an **Admin**. Admins create invitations from **Account → Team** and choose whether the invitee joins as Admin or Editor; there is no public registration or email delivery service. Share invitation links privately.

There are two roles. **Admins** invite people, change roles, remove accounts (which signs them out everywhere), run storage cleanup (`POST /api/storage/cleanup`), curate the workspace font library in **Account → Fonts** and read **Account → Activity**. **Editors** do everything else: open, edit, save and restore shared compositions, upload media, use workspace fonts, export and pair their own renderer. The server enforces these roles (403 for editors on `/api/auth/invitations`, `/api/users`, `/api/users/:id`, `/api/storage/cleanup`, `/api/audit`, `POST /api/fonts` and `PATCH`/`DELETE /api/fonts/:id`); the editor only hides controls editors cannot use. A workspace always keeps at least one admin: demoting or removing the last admin is refused with 409. Workspaces created before roles make their earliest account Admin and every other account Editor. Admin API: `GET /api/users` (id, email, role, createdAt, lastSeen), `PATCH /api/users/:id` with `{role}`, `DELETE /api/users/:id`, `POST /api/auth/invitations` with `{email, role}`.

The activity log records invitations created and accepted, role changes, removed accounts, successful sign-ins, compositions created, renamed, deleted or restored to a version, workspace fonts uploaded, renamed or deleted, storage cleanups with their counts, exports queued, cancelled, finished or failed (with format and resolution; outcomes are attributed to whoever queued the export) and renderer pairings. It keeps the newest 10,000 events. `GET /api/audit?before=<id>&limit=<1–200>` returns `{entries, next}` newest first; pass `next` as `before` for the following page.

Passwords are stored as salted scrypt hashes. Sessions use random, hashed server-side tokens and HttpOnly, SameSite cookies, with Secure cookies on HTTPS. Sessions expire after seven days; signing out revokes the current session. API data, uploaded media, workspace fonts and MP4 downloads require authentication. Renderer devices keep their separate bearer credentials, restricted to worker operations, asset and workspace font reads and export status. Use HTTPS for public hosting. Accounts, sessions and renderer registrations live in the workspace database; back it up with the workspace backup below.

Everyone who signs in has access to the whole shared library. Each tab remembers its active composition separately. Saved compositions use their own `updatedAt` revision; drafts use independent IDs and revisions. A conflicting save to the same composition is rejected instead of overwriting changes. The previous `project.json` is preserved and migrated into the library once; it is no longer the active global draft. Existing media paths remain valid.

Workspace state (accounts and roles, sessions, invitations, drafts, compositions, version history, renderer registrations, the workspace font library and the activity log) is stored in `FLOC_DATA_DIR/floc.db`, a SQLite database opened through Node's built-in `node:sqlite` with WAL, foreign keys and a busy timeout; it is created with mode 0600 and migrated in order at startup. The first start after upgrading imports the earlier JSON files (`access/`, `drafts/`, `templates/`, `renderers/`) in one transaction and records completion, so restarts never import twice. The JSON files are left untouched as a legacy backup and are no longer read or updated; render jobs stay as files under `renders/` so renderers never load database code.

The Dockerfile builds the frontend and scene bundle, installs only production Node dependencies, and includes Chromium and FFmpeg. `fly.toml` selects this image, port 8080 and the public origin. Local project data is excluded from the image. These files do not deploy the app by themselves.

`FLOC_DATA_DIR` selects writable storage for the saved project, uploads and exports (default `.data/`). Fly mounts the `floc_data` volume at `/data` and stores application data in `/data/floc-motion`. The container initializes ownership of this directory, then runs Node without root privileges. Hosting uses one machine: data persists across deployments, but there is no machine redundancy or simultaneous collaborative editing. Separate machines do not share projects or uploads; do not scale this SQLite-backed editor horizontally. The volume must exist before deployment.
### Workspace backup and recovery

Fly keeps automatic daily snapshots of the encrypted `floc_data` volume for five days. These snapshots are the first recovery layer, but they remain in the same Fly account. Keep periodic portable copies outside Fly as a second layer.

Create a portable backup directory, preferably from a write-idle workspace. The database is copied through SQLite's online backup, so it is consistent even while the editor runs; uploads and render files are copied as files:

```bash
npm run workspace:backup -- /path/to/floc-backup /path/to/workspace
npm run workspace:verify -- /path/to/floc-backup
```

The workspace argument defaults to `FLOC_DATA_DIR`, then `.data`. The backup contains a self-contained snapshot of `floc.db` (accounts, sessions, drafts, compositions with their version history, renderer registrations and the activity log), uploaded assets, the legacy JSON directories and `project.json` when present, and render `job.json`, `render-input.json`, and `render.log` files. It deliberately excludes generated engine files, render MP4s, prepared assets, frame directories, diagnostics, and `.tmp`/`.upload` files. `manifest.json` (format version 2, with a `database` entry naming the snapshot and its schema version) lists every included file in sorted order with its byte count and SHA-256 digest. Version 1 backups made before SQLite still restore; the server imports their JSON on first start. Treat the backup as sensitive because it contains account and device credential hashes.

Restore only while the application is stopped, into a missing or empty directory:

```bash
npm run workspace:restore -- /path/to/floc-backup /path/to/restored-workspace
```

Restore verifies the complete manifest, allowed paths, payload inventory, sizes, and hashes before writing, and runs SQLite's integrity check on the database snapshot both in the backup and in the staged copy. It refuses symbolic links, traversal paths, extra or missing payload files, corrupt files, and non-empty targets. There is no force or overwrite mode.

For Fly, create and verify the copy in ephemeral `/tmp` storage, download it before restarting normal writes, and then remove the temporary copy. Do not place the portable backup under `/data/floc-motion`, because that consumes the same volume and is not an independent copy. Fly volume restore remains a separate operator procedure: create a new volume from a selected snapshot, attach it to a stopped replacement machine, verify the workspace, and only then switch service traffic. Never restore over the attached live volume.
## Motion library previews

The motion library includes real six-second sample clips for each base template and all 108 catalog presets, rendered through the shared scene/export engine with local studio images. Clips play only while visible; the library provides a pause control and respects reduced-motion preferences. Base-template samples illustrate standard settings; preset samples use their actual supported recipe values, including orientation, card count and loop timing. The six-second excerpt repeats without changing the preset duration. These samples use studio images, not the current composition. Documentary reference sheets remain available in preset details. Presets with no visible cards in the sampled interval display an explicit notice rather than substituting a different configuration.

Regenerate the committed 480×270 MP4 clips and JPEG posters with `npm run previews:templates` or `npm run previews:presets`. This uses local Chrome and FFmpeg only; no project is saved or published.

## Implemented

- Circular, arc, depth and horizontal carousel templates.
- Original, liquid-wave, monochrome, duotone and chromatic-split shader presets.
- Shared ordered image collection (up to 48 images); upload, reorder and remove. Each carousel can also hold up to 48 cards of its own.
- Independently editable text layers; local image logo; layer visibility, stacking and timing; undo/redo (up to 200 edits or ~8 MB of compact diffs per composition). Each composition or draft keeps its own undo stack while you switch between them in a session, as long as it reopens unchanged; importing a project starts a new stack.
- Solid-color, image or silent video background, with cover/contain and video offset/loop controls.
- Music upload, source offset, volume, looping and fade in/out.
- Canvas formats: 1:1 (1080×1080), 9:16 (1080×1920), 16:9 (1920×1080), 3:4 (1080×1440) and 4:3 (1440×1080); 1–300 seconds, 24/30/60 fps; up to 50 layers. Limits live in `src/project-limits.js`; they were chosen so a 50-layer composition with three 48-card shader carousels, video layers and effect stacks still previews at 30 fps on an M2 Pro (80 layers drop to ~20 fps).
- Play, pause and seek; the same deterministic Three.js renderer drives preview and HyperFrames capture.
- Local MP4 export using HyperFrames, followed by an FFmpeg music mix and FFprobe verification.
- Autosave, project JSON import/download, optimistic revision checks.
- Native WebMCP tool registration and visible capability status.
- A local catalog of 108 reconstructed carousel recipes, with visual contact sheets and a validated adapter into the canonical FLOC carousel model.

## Files and privacy

### Studio typography

Text layers support Druk Wide Heavy (900), Geist Regular/Bold (400/700), and Geist Mono Medium/Bold (500/700). Geist 600/800 remain available for existing compositions. The same bundled WOFF2 registry drives the font selector, placement map, preview and self-contained MP4 jobs; fonts are not fetched from a CDN at runtime. Existing text without a font ID keeps Geist and its original weight. New demo headlines use Druk Wide, with Geist Mono for the signature; saved projects are not restyled automatically.

Geist Mono assets come from `@fontsource/geist-mono@5.3.0`; Geist assets come from the existing Fontsource package. Their OFL licenses are included in `public/fonts/`. Druk Wide was supplied by the studio; its commercial web/embedding permissions must be confirmed before publishing it.

#### Workspace fonts

Admins add licensed fonts in **Account → Fonts**: WOFF2, WOFF, OTF or TTF up to 10 MB, one file per weight and style. The server checks the magic bytes (`wOF2`, `wOFF`, `OTTO`, `0x00010000`/`true`) against the extension, rejects font collections, damaged files and exact duplicates (SHA-256), and reads the family, subfamily, `OS/2` weight and italic flag from the font tables (WOFF2 table data is Brotli-decompressed with `node:zlib`). A typed family name replaces the embedded one; family, weight (100–900) and style can be renamed later. Files are stored as `FLOC_DATA_DIR/fonts/<id>.<ext>` and included in workspace backups. API: `GET /api/fonts` (any signed-in user), `POST /api/fonts?name=<file>[&family=&weight=&style=]` with the raw file, `PATCH /api/fonts/:id` with `{family, weight, style}`, `DELETE /api/fonts/:id`; the files are served from `/fonts/workspace/<id>.<ext>` to signed-in users and paired renderers with private, no-store caching.

Every editor sees the library in the text **Font** selector, under **Workspace** after the studio fonts. A text layer stores the exact face as `font: "workspace:<id>"` with its weight. Preview and export declare each face under the alias `floc-workspace-<id>` together with the other weights of its family and style, so CSS font matching uses the nearest available weight, and the editor waits for the faces before the first frame. Validation accepts any well-formed workspace ID (it has no font library); a face that is not in the library renders in Geist and the inspector shows a missing-font warning. A face cannot be deleted while a composition, one of its retained versions or a draft names it; the 409 lists them. Exports copy the referenced faces into the job folder (`fonts/`) with relative `@font-face` rules; the face list travels with renderer jobs and renderers download the files with their renderer credential (a face deleted meanwhile falls back to Geist). Renderers installed before this release must be updated.

Uploaded assets and saved projects live in `.data/` (git-ignored). Server-local and legacy shared-worker exports also live there. A personal renderer instead saves each verified export (`.mp4`, `.mov` or PNG-sequence `.zip`) to `~/Movies/FLOC Motion` on macOS or `~/Videos/FLOC Motion` on Windows; the file is never uploaded to Fly. Existing filenames are never overwritten: collisions create ` (2)`, ` (3)`, and later numbered copies. Rendering copies only selected resources into a self-contained local job directory. No remote assets are accepted in imported projects or agent edits. HyperFrames telemetry is disabled for app renders. Uploaded SVG/code is not accepted; bundled original examples and the known official FLOC SVG are explicitly allowed.

Project JSON references local resource paths; it is **not** a portable archive. Keep `.data/assets/` when moving the installation. Deleting a project does not immediately delete media; only reference-aware cleanup can remove assets after the retention period.

Workspace media is capped at 1.5 GB. `GET /api/storage` reports total, referenced, orphaned and cleanup-eligible bytes. Orphans are retained for seven days. `POST /api/storage/cleanup` (admins only) performs a dry run by default; send `{"confirm":true}` to remove only eligible unreferenced assets. Uploads that would exceed the quota first run the same safe cleanup, then return HTTP 507 if referenced/recent media still leaves insufficient space. References come from an index the database maintains for drafts, compositions and every retained version (so restoring a version never loses its media), plus render job files and the legacy `project.json`. Cleanup aborts if one of those files cannot be read.

## Agent control / WebMCP

This implements the current **`document.modelContext.registerTool`** API, using AbortSignal-based cleanup. Tool execution uses the same runtime validation and autosave as human edits. See the [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) and [WebMCP specification](https://webmachinelearning.github.io/webmcp/).

WebMCP is experimental and requires a compatible browser **and** agent. The Agent tools dialog reports actual availability; an unsupported browser is not presented as connected and no browser flags are changed. Registration is feature-detected, with no fake polyfill.

Tools: `floc_get_project`, `floc_list_effects`, `floc_list_catalog`, `floc_get_preset`, `floc_apply_preset`, `floc_set_carousel`, `floc_set_shader`, `floc_update_layer`, `floc_add_text`, `floc_set_output`, `floc_seek_preview`, `floc_request_export`, `floc_get_export_status`.

The bundled catalog is a local reconstructed recipe dataset. `floc_apply_preset` maps only supported fields into the canonical project schema and reports the fields that still need native FLOC implementations. The raw catalog is available at `/catalog/presets.json`; the editor shows its visual contact sheets in the carousel inspector.

`floc_request_export` only opens the confirmation dialog. **A person must click Render MP4.** Agents cannot publish, run shell commands, import arbitrary shader code or delete resources through these tools.

Example request: “Switch to the arc template, use monochrome at 70%, add a title at the top, and show me the frame at 3 seconds.”

A local HTTP API is also available: `GET /api/catalog` (templates, catalog metadata and the raw catalog URL), `GET /api/templates`, `GET /api/templates/:id`, `PUT /api/templates/:id` with `{name, project, updatedAt}`, `GET /api/templates/:id/versions` (version metadata, newest first), `GET /api/templates/:id/versions/:n` (one version with its project), `POST /api/templates/:id/versions/:n/restore` with `{updatedAt}`, `GET/PUT /api/drafts/:id` with `{project, revision}` for draft writes, `POST /api/assets?name=...` (raw file body), `POST /api/exports` with `{project, settings}` (optional `settings`: `quality` draft/standard/high, `resolution` 1080p/2160p, `format` mp4/mov/png, `transparent` for mov/png), `GET /api/exports` (unfinished exports visible to this browser in the order they will run, waiting ones with their queue `position`, then the 20 most recent finished ones), `GET /api/exports/:id`, and `POST /api/exports/:id/cancel`. Exports end as `done`, `failed` or `cancelled`; exports still running or waiting when the editor restarts are marked `failed` at startup. REST edits take effect in an already-open editor after reload; WebMCP actions update the live editor directly. Browser mutations require a same-origin request and a valid session cookie; authentication is enforced by the server.

## Add a carousel or shader

1. Add its stable ID/name to `TEMPLATES` or `SHADERS` in `src/project.js`.
2. Implement the layout or GLSL branch in `src/scene.js`. Derive all visual state solely from the supplied time; never accumulate animation deltas. Carousel-wide parameters belong in `applySettings` and per-card values in `cardUniforms`, so in-place preview edits draw exactly what a rebuild draws. A parameter that needs new decoders, meshes or DOM nodes must be listed in `STRUCTURAL` in `src/scene-update.js`.
3. Add any relevant controls to the inspector components in `src/editor/components/`, and validate new parameters in `src/project.js`.
4. Run tests and build; verify seeked frames and an MP4. Catalog selectors and WebMCP enum schemas derive from the registry automatically.

Adding implementations is a source-code change, not runtime execution of pasted code.

## Prototype boundaries

No simultaneous collaborative editing, cloud rendering, arbitrary plugins, 4K/GIF/WebM output or video cards. Browser preview depends on local codec/WebGL support. MP4 export is a local job; keep the server running. The local editor and each personal renderer render one export at a time; up to 50 more wait in a first-in, first-out queue (the shared Mac render worker still takes one). Exports follow the 300-second composition limit; frame capture may run for up to 6 seconds per 1080p-equivalent frame (never less than 20 minutes) before it is stopped, so a 5-minute 2160p60 export is not cut short. Long exports are slow rather than memory-bound: on an M2 Pro (4 workers) a 50-layer, 300-second 1080p30 composition took about 9 minutes with light effects, while effect-heavy compositions capture about 4× slower and 2160p about 4.5× slower again. This is a functional prototype, not production acceptance or a complete replica of the references.

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

The editor retains the active animation while preparing a replacement scene. Parameter edits (shader and post-effect settings, carousel motion, size and appearance, colors, timing, text, procedural background settings and effect stacks) update the live scene in place. Only structural edits rebuild it: adding, removing, reordering or retyping layers, changing the format, a carousel template, card count or card sources, a media, model or background source/mode, or an adjustment scope; changing a font face rebuilds when the face is not loaded yet. Rebuilds reuse decoded card images, card video decoders and parsed GLB models from the same preview session; the last scene to release them disposes them. Rapid edits are coalesced to the latest project, with one replacement loading at a time; failed loads preserve the previous preview and report an error. The displayed scene resumes at the current playhead rather than restarting. Preview rendering follows the visible frame size (up to 2× display pixel density); exports retain the full composition resolution. Replaced scenes release their media, GPU resources and WebGL context. If the browser drops a WebGL context, the preview redraws once it is restored and reports an error if it is not restored within five seconds; an export fails instead of capturing blank frames. Whole-carousel effects use half-float buffers where available and fall back to sRGB 8-bit buffers otherwise.

### Direct canvas editing

Click visible text, a logo or a carousel card to select its layer and synchronize the inspector. Drag text/logo between the existing 6×6 grid anchors. Drag a carousel card for X/Y orientation, or its visible ring for Z, using the same orientation math as the sidebar (not a new camera). Arrow keys provide grid movement or orientation; Alt adjusts Z and Shift increases the rotation step. Escape cancels the draft; pointer release commits one undoable edit. Locked layers can be selected but cannot be manipulated.

Wheel over the selected element to resize: font size for text, logo size, or card size for the carousel. A wheel burst commits one edit after 250 ms, using existing validated bounds. Ctrl+wheel is left to the browser. Outlines, guides and the rotation ring are editor-only and are never exported.

### Choreography states

Text, logos, media, carousels, 3D models and effect layers support up to 32 choreography states per layer. Every state holds the pose: opacity, plus position, size and rotation on all but effect layers; carousels and models also hold tilt and yaw. Select a layer and use **Choreography → Save state** at the playhead. Saving also captures what the layer can animate beyond its pose: text color, letter spacing and line height; carousel shader intensity and post-effect mix; and the primary amount of the layer's first blur (radius), noise (opacity), monochrome and optical-warp effect. The state's controls list what it holds. Once states exist, changing pose properties in the inspector or canvas updates the current state or records a new state at that frame. Other properties edit the state only once a state holds them, so static values stay static. A state that omits a property leaves it to the neighboring states that hold it, or to the layer's own value; text colors blend in linear RGB. The carousel's preset motion continues inside its animated placement.

Click a state to seek to it; drag its timeline diamond or edit **Time (s)** to move it. Arrow keys move a diamond by one frame (Shift: ten), Home/End move within its neighbors, and Delete removes it. Each destination state picks the curve of its incoming transition from the shared easing library, also used by carousel progress curves: Linear, Smooth, Ease in, Ease out, Natural, Glide, Slow, Vive, Back, Bounce, Elastic, or a custom cubic bézier (`x1, y1, x2, y2`; both x values between 0 and 1) with a curve preview. Overshooting curves stay within each property's limits. States move with their layer; trimming preserves states outside the visible clip. Undo and layer locks apply to state edits. Preview and export evaluate the same values from the supplied time and apply them to the live scene without rebuilding it.

### Editable template content

Give a text, carousel, logo, media or music layer a **Template field → Field name** in the inspector to expose its content. Leave the name blank to keep that layer out of the content form. A field can be marked **Required**, and text fields can set **Maximum characters** (1–500). Each field gets a stable ID (shown in the inspector, e.g. `headline`, `headline-2` for a repeated label) that survives renames; its type follows the layer. Projects saved before typed fields (schema v2) migrate on load: each label becomes an optional field with an ID derived from it. Save the composition, then choose **Use as template** in **Compositions** to fill these fields and create an independently saved composition. **Open composition** continues to edit the original saved entry.

The header's **Content** form edits only declared fields, including content in locked layers. Required fields are marked and text with a maximum shows a character counter; **Apply** stays disabled while a required field is empty or text is too long. Position, styling, timing and choreography stay intact; configuring field names still requires an unlocked layer. Carousel uploads replace only that layer's cards. Changes remain in a private preview until applied as one undoable edit; Cancel leaves the composition unchanged.

**Batch variants** in the Content form turns the template into a table with one row per output (up to 50) and one column per field. Type values, pick media from files already used in the workspace or upload new ones, or paste CSV/TSV rows: a header row may name columns by “Name”, field label or field ID (without one, columns are the name followed by the text fields); media cells take an uploaded file name and carousel cards are separated by `|`. **Review** checks every row before anything is saved: empty required values, text over its maximum, text that does not fit the safe area (or runs past the frame) at any choreography pose in each selected linked format — laid out with the same stage markup and bounds the editor uses — missing or unsupported files, and duplicate or empty output names. Only a clean review enables **Create compositions** (each row becomes its own saved composition) and **Export all** (one export per row and selected linked format, queued with the settings chosen in **Export**). Exports still need this click; agents cannot start them.

### Linked format versions

Enable **Linked formats** under Canvas to make the current ratio the master and generate assisted 1:1, 9:16 and 16:9 adaptations. The ratio buttons switch between versions; the existing 3:4 and 4:3 ratios are adapted when first selected. Each version retains its placement, size, orientation, framing, safe margins and text font, weight, width, line height, letter spacing and alignment. Content, assets, layer order, visibility, duration, media settings and carousel motion remain shared. Choreography state IDs, times, easing, opacity and animated color, typography, shader and effect values are shared; each format keeps its own pose coordinates and sizes.

Correct a version with the ordinary inspector and canvas controls. **Reset from master** regenerates the active adaptation from the master's current layout. Disabling Linked formats retains the active composition and removes the other layouts. These actions are undoable. Saved compositions and project JSON retain all versions; preview, agent output switching and manual MP4 export use the active version through the same scene engine.

### Layers

The layer list shows frontmost layers first. Drag a row to reorder it; the insertion line indicates its new position. Double-click a name (or use Rename / F2) to rename it, Enter to commit and Escape to cancel. Arrow buttons and Alt+Up/Down provide keyboard ordering. Text and logo layers can be duplicated above their source; background, carousel and music remain singletons, with a 50-layer project limit.

Locks persist in project JSON and prevent property, timing, order and removal edits. Locked layers can still be selected, hidden/shown and unlocked. Every editor, visual-alternative and agent change is checked against the previous project, so a locked layer cannot be altered indirectly; moving unlocked layers around it remains possible. Locks are editing safeguards, not permissions: opening or importing a project, Undo/Redo, composition-wide duration changes, linked-format switching/reset (layout fields only) and the Content form (declared fields only) retain their normal behavior. Locking does not change rendering or export.

### Multi-selection, alignment and command palette

⌘/Ctrl-click a layer row toggles it in the selection and Shift-click selects the listed range from the last plain or toggled row; on the canvas, Shift- or ⌘/Ctrl-click toggles a layer (dragging with those modifiers keeps their usual meaning). ⌘/Ctrl+A selects every unlocked, visible text, logo, media, 3D model and carousel layer at the playhead; Escape clears a multi-selection back to the last clicked layer after canceling any active gesture. Dragging any selected layer or pressing the arrow keys moves every unlocked member together as one undoable edit (Shift skips snapping and uses the big nudge); the shared offset stops at the first member's position limit so the arrangement keeps its shape. Delete, duplicate, lock/unlock and hide/show act on the whole selection as one edit; locked members stay put and Delete/Duplicate report them.

With two or more layers selected, the canvas toolbar and the inspector align left, horizontal centers, right, top, vertical centers or bottom to the selection's bounds, measured from the rendered boxes the placement guides use (locked members anchor the bounds without moving). With one layer selected, alignment uses the canvas, or the safe area when layout margins are on. Distribute horizontally/vertically leaves the outermost layers in place and equalizes the gaps between three or more unlocked layers.

⌘K / Ctrl+K opens the command palette: fuzzy-search adding layers, playback, Undo/Redo, export, new/save/open composition, version history, Explore styles, timeline and zoom, alignment and selection actions, and Account. Unavailable commands are listed dimmed. Arrow keys move between available commands, Enter runs one and Escape closes the palette. **Export video…** opens the usual export dialog; nothing renders without its confirmation.

### Animated carousel media

Carousel cards accept local images, GIF, MP4 and WebM (75 MB per uploaded file). Mixed media share the existing ordering and templates. Videos loop silently from the carousel layer's start; pause and timeline seeking select the corresponding decoded frame. Repeated cards share a video decoder/texture for each source instead of loading a video per mesh. High-resolution videos and many simultaneous sources can increase preview cost.

GIFs retain their original file and get a local, cached VP9 WebM derivative for seekable playback, including older saved GIF cards. Conversion uses the already-required FFmpeg and preserves frame timing and alpha. Preview and export use the same media clock. Export waits for frame decoding through the renderer's `hf-seek`/`waitUntil` contract before capturing WebGL, rather than using an independent playback clock. Unsupported codecs or unreadable media report an error; upload format alone does not guarantee codec support.

### Saved composition templates

Open **Saved templates** in the header to save a complete composition snapshot with a name and up to ten searchable tags. A selected template has a real, on-demand engine preview; gallery covers are media references, not rendered composition thumbnails. Rename or retag a template without changing its saved scene. Applying a template replaces the full composition after confirmation and uses the editor's existing Undo history.

Saved compositions persist as validated projects in the workspace database, separately from autosaved drafts. Uploaded media are referenced in the same workspace rather than duplicated; deleting a composition (and its version history) does not delete media or the current project. These are workspace-local snapshots, not portable media archives or cross-device sync.

Every save that changes a composition's project or name records a version with its author and time; changing only tags or saving identical content does not. Autosaves by the same author within 10 minutes of when the newest version started update that version in place (its displayed time becomes the latest save), so continuous editing yields about one version per 10 minutes; another author, creating, importing and restoring each start a new version. The newest 100 versions per composition are kept. With a saved composition open, **Version history** in the header lists versions (time, author email, name). **Restore** asks for confirmation, saves pending work, and records the selected state as a new current version; older versions are never rewritten. The restore respects the composition's `updatedAt` revision and is applied as one ordinary edit, so Undo returns to the previous state and autosaves it as another version.

## Mac render worker

The shared editor can delegate exports to a trusted Mac without exposing a local port. Set `FLOC_RENDER_WORKER_TOKEN` on the shared server and create `.data/render-worker/config.json` on the Mac with `{"origin":"https://floc-motion.fly.dev","token":"<same random token>"}`. Restrict that file to the current user (mode 0600). Run `node scripts/render-worker.mjs`; the worker downloads validated project media, uses the native browser GPU, renders with the pinned HyperFrames engine and uploads the verified MP4. The existing export confirmation and download button remain in place. When the Mac is offline, new exports fail immediately with an explanatory message; interrupted jobs fail after 90 seconds without a heartbeat. Only one export runs at a time. The Mac must remain awake and connected. No Runpod resources are used.

### Visual language

Background Source includes **Procedural** with a curated collection of 12 patterns. Each tile is drawn by the same renderer as the composition. Base color, pattern color, scale, intensity, speed and seed remain editable; a speed of zero freezes the pattern. Procedural animation derives from the supplied layer time, so reverse seeking and export reproduce the same image. Existing image and video backgrounds remain available.

Text layers include line height, letter spacing in em, alignment and directional wipe reveals with an adjustable duration. Typography is local to each linked format; reveal direction and timing remain shared. Previews, placement measurements and export use the same style values. These settings are saved in project JSON and validated for human and WebMCP edits. MP4 export still requires **Render MP4** confirmation.

### Personal renderers (Windows / Mac)

Public exports require a renderer connected to the current browser. In **Export**, download the renderer ZIP, choose **Connect this computer**, and enter the ten-minute code in the installer. Each browser has an HttpOnly connection cookie; each engine has a separate credential. The server stores credential hashes, assigns at most one active job per engine and hands out up to 50 queued exports in order as it claims them, supports concurrent engines, and restricts progress and results to the owning connection. A renderer that stops checking in for 90 seconds fails its current and queued exports. No local listening port is opened. A personal renderer saves verified MP4 files in `~/Movies/FLOC Motion` on macOS or `~/Videos/FLOC Motion` on Windows. The editor stores only completion status and the saved path; it never receives or retains the MP4 bytes. The existing shared worker protocol remains available for existing installations, and its completed exports retain the browser download.

`npm run build` includes `dist/renderer/FLOC-Motion-Renderer.zip`; `npm run build:renderer` rebuilds just the installer. The ZIP contains only engine sources, pinned dependency metadata, bundled brand/font/demo assets and installers, without credentials, uploaded media or project data. Installers download a SHA-256-verified private Node 24 runtime, install dependencies with the lockfile, provision a dedicated Chrome Headless Shell through HyperFrames, check its version response and native hardware WebGL, check FFmpeg/FFprobe, and enable per-user startup. This avoids depending on the user's everyday Chrome installation; `HYPERFRAMES_BROWSER_PATH` remains an explicit override. Windows x64 requires Windows 10/11 with WinGet; macOS uses Homebrew to install missing FFmpeg.

Updating this release requires running the newly built installer with a new ten-minute pairing code. `scripts/render-worker.mjs`, `scripts/renderer-runtime.mjs`, and `package-lock.json` participate in the renderer fingerprint, so an older installation reports **Update your renderer to match the editor**. Use the product installer rather than patching its files so the runtime, browser check, credential, and LaunchAgent stay consistent. The installer is unsigned; Windows runtime compatibility needs an actual Windows test, not just a successful build. For local isolated checks, `node scripts/renderer-setup.mjs --origin http://127.0.0.1:<port> --code <code> --no-autostart` connects without modifying startup settings. `--check` only verifies prerequisites and GPU access.

For an existing Mac renderer whose system Chrome times out during `--version`, run `Repair-Mac.command` on that Mac. It prepares a dedicated rendering browser, verifies its version response, updates only the browser path in the existing configuration and restarts the renderer. Credentials and engine files are preserved, so this repair does not require a new connection code or an editor deployment. Wait for **Ready** before confirming **Render MP4** again.

### Visual alternatives

**Explore styles** opens three installed creative directions: Editorial, Bold and Experimental. Switch between their real previews and **Original** at the same playhead time, then choose **Apply alternative**. Comparison stays private; applying a proposal is one undoable edit through the usual autosave. Content, local media, layer timing, locks and inactive linked-format corrections are preserved.

A connected native WebMCP agent can submit 2–3 custom directions with **floc_propose_alternatives**. Read **floc_get_project** first and pass that snapshot as `base`, with each alternative's name and per-layer visual patches. Proposals use installed styles and the canonical validator; they cannot upload code, replace content or start a render. The app rejects stale proposals and changes made while another comparison is open. A person chooses which proposal to apply.

Numeric controls accept whole numbers by typing their value and pressing Enter or leaving the field; Escape restores the saved value. Fractional scales use percentages, timing uses milliseconds, and text tracking uses thousandths of an em. Preview and saved projects retain their original precision until an edit is confirmed. Nudge amount in the canvas toolbar sets Small nudge (arrow keys) and Big nudge (Shift + arrow keys), in composition pixels; preferences are saved in this browser. Alt + arrows or a focused rotation handle still adjusts rotation.
