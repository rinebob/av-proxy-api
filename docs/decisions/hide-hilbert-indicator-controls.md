# Decision: Hide Hilbert Transform Indicator Controls

Last updated: 2026-08-18
Status: Accepted

## Context

The chart-view component shipped with a set of UI controls for the Hilbert Transform
endpoint indicators (Topic #17):

- Local HT Calc toggle (client-side calculation)
- Series-type dropdown (Close / Open / High / Low)
- Six endpoint indicator buttons: Trendline, Sine, DC Period, DC Phase, Trend Mode, Phasor
- Sine display mode toggle (Pane / Overlay / Both)

These were added to evaluate whether the Hilbert Transform indicators — particularly
`HT_TRENDLINE` — could surface useful trend information on top of the price chart.

## Decision

Hide all of the above controls from the UI. The underlying code (component handlers,
store methods, chart series bindings, AV endpoint service) is preserved behind a
single `showIndicatorControls` signal on `ChartViewComponent`, defaulted to `false`.

## Rationale

After exercising the controls against live data, the indicators did not demonstrate
the potential that was hoped for when the feature was built. The trendline output
in particular did not provide actionable signal beyond what is already visible on
the price chart, and the supporting indicators (Sine, DC Period/Phase, Trend Mode,
Phasor) did not justify the UI surface area they consumed.

This is a product judgment, not a defect finding. The chart rendering, AV data
fetching, and client-side calc were all verified to be working as designed during
the investigation.

## Implementation

- `ChartViewComponent.showIndicatorControls = signal(false)` is the single switch.
- The controls and the local HT Sine Wave chart series are wrapped in
  `@if (showIndicatorControls())` blocks in `chart-view.component.html`.
- No store methods, services, or chart series definitions were removed.
- To re-enable the controls for future re-evaluation, flip the signal to `true`.

## Alternatives Considered

- **Delete the code outright.** Rejected — the implementation represents real work
  and may be worth revisiting if a different use case emerges (e.g. a dedicated
  indicator pane view, or a different indicator family that reuses the toggle
  infrastructure).
- **Keep the controls visible.** Rejected — they add clutter without delivering
  value in their current form.
