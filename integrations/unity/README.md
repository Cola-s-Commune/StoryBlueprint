# Story Blueprint Unity Adapter

This directory is the planned home for the Unity integration. It is intentionally split into two layers:

- `package/`: the reusable UPM package and C# runtime. It must not depend on a particular game or on `UnityEditor` for runtime execution.
- `samples/RuntimeDemo/`: a small Unity host used to verify loading, presentation, cancellation, save/load, and platform builds.

The first implementation slice is the native Blueprint Runtime only. Embedded or linked Ink Block instructions are rejected with a structured unsupported-instruction diagnostic until Ink C# runtime compatibility is separately evaluated.

## Interaction modes

The same `.storyc.json` must support both:

1. Manual mode: Dialogue and Narration wait for player confirmation; Choice waits for a selected option.
2. Auto-play mode: Dialogue and Narration complete after a host-defined duration or voice completion; Choice still waits for player selection unless the host explicitly enables timed choices.

These modes belong to the Unity presenter/adapter configuration, not to the story file.

## Planned layout

```text
integrations/unity/
  package/
  samples/RuntimeDemo/
  README.md
```

See [the implementation plan](../../docs/unity-adapter-plan.md) for milestones and acceptance criteria.
