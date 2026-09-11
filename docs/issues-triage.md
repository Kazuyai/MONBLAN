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
| #16   | bug       | Fixed: partial-playback initialization effects are consolidated.   |
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
| #41   | enhancement  | Fixed: selection start, end, and duration are shown on timeline.    |
| #35   | code-quality | Fixed: duplicated containerRefs initialization is removed.          |
| #34   | code-quality | Fixed: unused setTimelineContainerRef is removed.                   |
| #31   | code-quality | Fixed: stale commented-out UI and playback code is removed.         |
| #30   | code-quality | Fixed: debug console.log calls are removed or converted to logging. |
| #23   | feature      | Fixed: project JSON save/load is available for editing sessions.    |
| #22   | UX           | Fixed: fallback fps is explicit and manually adjustable.            |
| #21   | UX           | Fixed: guidance is shown before loading a video.                    |
| #20   | UX           | Fixed: blocking alerts are replaced by inline/floating notices.     |
| #17   | latent-bug   | Fixed: frameWidth/timelineWidth are no longer duplicated state.     |
| #42   | AI completion | Fixed: similarity completion is available from UI/API.             |
| #8    | AI analysis    | Fixed: partial-analysis scope is available from UI/API.            |
| #6    | AI completion | Superseded by #42 similarity completion integration scope.         |
| #5    | AI pipeline  | Fixed: local motion-detection pipeline is available through API.    |

## defer

These are larger architecture/performance/enhancement items or are less urgent
than verified user-facing bugs.

| Issues                       | Area                      |
| ---------------------------- | ------------------------- |
| #40, #39, #38, #37           | architecture              |
| #36, #33, #32                | code-quality              |
| #29, #28, #27, #26, #25, #24 | performance               |
| #7, #4, #3, #1 | enhancements / AI completion |

## Recommended next order

1. Review #43 button UI consistency after the AI workflows are stable.
2. Consider #3 joint-selection UI improvements if the button styling work exposes related usability issues.
