# FLOC Motion project conventions

- Keep this an internal, loopback-only application. No external calls or publishing without user approval.
- Preview and export must share `src/scene.js` and derive motion/shaders from a supplied time.
- Validate human, imported and agent-driven edits through `src/project.js`.
- WebMCP tools use `document.modelContext`, native feature detection and AbortSignal cleanup. Do not pretend an unsupported browser is connected.
- Agent export requests open a human confirmation dialog; do not bypass it.
- No eval, runtime shader/code imports, arbitrary shell commands or remote resource URLs.
- Add presets to the central registry, then implement and test their actual visual behavior.
- Run `npm test` and `npm run build`; test real exported frames for render-affecting changes.
- UI and code use English. Direct user replies follow the current conversation language.
