# GitHub Issues Triage

Snapshot date: 2026-08-03.

Phase 2 has confirmed the successful path for Electron -> FastAPI startup,
`GET /environment/`, `POST /get_framerate/`, `POST /get_human_images/`, and
`POST /items/`. AI API failures now surface inline error details and preserve
the server-side job directory for debugging. Remaining UI alerts should be
addressed separately under #20.

## must-fix

These issues can cause incorrect behavior, broken exports, or state corruption.
Handle them before broad architecture cleanup.

| Issue | Area      | Recommended action                                                 |
| ----- | --------- | ------------------------------------------------------------------ |
| #19   | UX / undo | Fixed: layer-name edits enter undo history only on commit.         |
| #16   | bug       | Merge duplicated partial-playback initialization effects.          |
| #15   | bug       | Fixed: playhead position is derived from frame after zoom changes. |
| #14   | bug       | Fixed: selected layer is clamped or cleared after layer changes.   |
| #13   | bug       | Fixed: timeline clicks ignore annotations via explicit data marker. |
| #12   | bug       | Fixed: annotation drag and resize are tracked at document level.   |
| #11   | export    | Fixed: CSV cells escape commas, quotes, and newlines.              |
| #10   | export    | Fixed: EAF media descriptors are emitted inside HEADER.            |
| #9    | bug       | Fixed: frame and timeline widths are derived from zoom state.      |

## should-fix

These improve usability or maintainability. Handle them after must-fix items,
or together with related work.

| Issue | Area         | Recommended action                                                  |
| ----- | ------------ | ------------------------------------------------------------------- |
| #41   | enhancement  | Show selection start/end time in timeline UX pass.                  |
| #35   | code-quality | Remove duplicated containerRefs initialization.                     |
| #34   | code-quality | Remove unused setTimelineContainerRef if still unused.              |
| #31   | code-quality | Delete commented-out code while touching related files.             |
| #30   | code-quality | Remove console.log or replace with logging.                         |
| #20   | UX           | Fixed: blocking alerts are replaced by inline/floating notices.     |
| #17   | latent-bug   | Fixed: frameWidth/timelineWidth are no longer duplicated state.     |

## defer

These are larger architecture/performance/enhancement items or are less urgent
than verified user-facing bugs.

| Issues                       | Area                      |
| ---------------------------- | ------------------------- |
| #40, #39, #38, #37           | architecture              |
| #36, #33, #32                | code-quality              |
| #29, #28, #27, #26, #25, #24 | performance               |
| #23, #22, #21                | UX / feature completeness |
| #8, #7, #6, #5, #4, #3, #1   | enhancements              |

## Recommended next order

1. Continue with remaining must-fix timeline interaction bug: #16.
