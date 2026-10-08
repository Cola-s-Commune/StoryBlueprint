# Story Blueprint Unity Adapter

This directory is the planned home for the Unity integration. It is intentionally split into two layers:

- `package/`: the reusable UPM package and C# runtime. It must not depend on a particular game or on `UnityEditor` for runtime execution.
- `samples/RuntimeDemo/`: a small Unity host used to verify loading, presentation, cancellation, save/load, and platform builds.

The first implementation slice is the native Blueprint Runtime only. Embedded or linked Ink Block instructions are rejected with a structured unsupported-instruction diagnostic until Ink C# runtime compatibility is separately evaluated.

The created `samples/RuntimeDemo` project uses Unity 2022.3. Its local package reference points to `../../package`. Open the project in Unity, add `RuntimeDemoPresenter` and `RuntimeDemoRunner` to a scene object, and place a compiled `sample-quest.storyc.json` under `Assets/StreamingAssets/` to run the first smoke flow.

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

## Current core

`package/Runtime/StoryRuntime.cs` is a pure C# runtime slice. It loads either a standalone
`story-runtime` program or a compiled-project envelope, executes dialogue, narration, choices,
branches, jumps, variable assignments, and `end-story`, and delegates presentation to
`IStoryPresenter`. Presenter implementations choose manual or automatic dialogue playback;
choices remain interactive. `CancellationToken` is passed through every asynchronous presentation
call so scene teardown and skip operations can stop pending work safely.

The offline smoke project under `package/Tests/` can be run with `dotnet run` in an environment
with NuGet access. Unity imports the same source through the package assembly definition.
