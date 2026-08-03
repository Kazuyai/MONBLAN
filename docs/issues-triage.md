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
| #19   | UX / undo | Push layer-name edits to undo only on edit commit.                 |
| #16   | bug       | Merge duplicated partial-playback initialization effects.          |
| #15   | bug       | Recompute playhead position from frame after zoom changes.         |
| #14   | bug       | Define selectedLayerIndex behavior when all layers are removed.    |
| #13   | bug       | Remove fragile class-name dependency from timeline click handling. |
| #12   | bug       | Track annotation dragging at document/window level.                |
| #11   | export    | Fixed: CSV cells escape commas, quotes, and newlines.              |
| #10   | export    | Place EAF MEDIA_DESCRIPTOR under the correct HEADER element.       |
| #9    | bug       | Synchronize zoom state with timeline rendering.                    |

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
| #20   | UX           | Continue replacing blocking alerts; AI API failures are now inline. |
| #17   | latent-bug   | Consolidate frameWidth/zoomLevel state with zoom fixes.             |

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

1. Fix EAF export correctness: #10.
2. Finish #20 for remaining timeline/export alerts.
3. Fix state/undo correctness: #14 and #19.
4. Fix timeline zoom/playhead synchronization: #9, #15, and #17.
