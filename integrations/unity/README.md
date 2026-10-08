# Story Blueprint Unity Adapter

Reusable UPM package targeting Unity 2022.3 LTS. The pure C# `StoryBlueprint.Runtime`
assembly executes native Blueprint instructions; `StoryBlueprint.Unity` connects them to
the Unity main thread, presentation and game callbacks. Runtime code does not depend on UnityEditor.

## Install and run

Add `integrations/unity/package/package.json` with **Package Manager → Add package from disk**.
Unity installs `com.unity.nuget.newtonsoft-json` 3.2.1 and the required engine modules.
For a repository dependency, use a pinned commit or release tag:

```text
https://github.com/<owner>/StoryBlueprint.git?path=integrations/unity/package#<commit-or-tag>
```

Open `samples/RuntimeDemo` with Unity 2022.3 and play `Assets/Scenes/SampleScene.unity`.
The scene bootstraps its runner automatically and includes the published dragon quest in
StreamingAssets. Continue reveals typing text first, then advances. Both manual and auto
playback wait for a choice. Accept the quest, click **Defeat the red dragon**, and the fake
`ev_grant_reward` handler returns the stable `evo_success` output. The demo also supports
cancel, restart and saving/loading the current pause with its game gold value.

## Game integration

Add `UnityStoryHost` to a scene object. It installs a `UnityStoryPresenter` and a
`UnityMainThreadDispatcher`; set a compiled `TextAsset` or StreamingAssets path in the Inspector.
For game handlers, subclass the host and override `ConfigureAdapter`:

```csharp
protected override void ConfigureAdapter(UnityStoryAdapter adapter)
{
    adapter.RegisterEvent("ev_grant_reward", (request, token) =>
    {
        token.ThrowIfCancellationRequested();
        // Implement the game action using request.Arguments and request.RequestId.
        return Task.FromResult(new JObject { ["evo_success"] = true });
    });
    adapter.ExternalVariableReader = (definition, token) =>
        Task.FromResult(GameSave.Read((string)definition["id"]));
    adapter.ExternalVariableWriter = (definition, value, token) =>
        GameSave.WriteAsync((string)definition["id"], value, token);
}
```

The example assumes your own `GameSave` implementation and imports `System.Threading.Tasks`,
`Newtonsoft.Json.Linq` and `StoryBlueprint.Unity`. Event output keys must match compiled output
IDs, including outputs not bound to a variable. Missing or invalid values fail before any result
is committed. Extra event fields are ignored when storing declared outputs. `RequestId` identifies
the compiled instruction. For retryable side effects, hosts must persist a business operation key
that also identifies the story instance and execution occurrence. Reuse that key for retries;
later loop executions and new playthroughs need distinct keys.

`project` and `character` variables hydrate through the adapter once, and dirty values flush at
interactions and completion. Writes remain queued until the host confirms success; use
`RetryExternalWritesAsync` after a failed write. Restored states retain hydrated values and queued
writes. Without persistence callbacks, the adapter uses compiled defaults and acknowledges writes
in memory.

For custom UI, implement `IStoryPresenter`, subclass `UnityStoryPresenter`, or set `DrawDefaultGui`
to false and subscribe to `DialoguePresented`, `NarrationPresented`, `ChoicePresented` and
`InteractionCleared`. Complete interactions through `Advance`, `RevealText` and `SelectChoice`.
`SpeakerResolver`, `PortraitResolver` and `VoiceResolver` receive stable resource IDs. Set
`TextResolver` on the adapter for a game localization service; returning null uses the compiled
text variants and locale fallbacks. The compiled project retains character/asset and event/signal
manifests in `StoryProject.Data` for your resource resolver.

Auto playback waits for the configured minimum/per-character duration after text is visible,
and optionally for voice completion. Choice always requires player input. Scene destruction,
object disable, reload and cancellation clean up the active UI, typing and audio. Each concurrent
story needs its own presenter. Adapter game callbacks are marshalled to the Unity main thread.

## Core API and saves

```csharp
var project = StoryProject.Parse(compiledJson);
var storyId = project.EntryStoryId;
var runtime = new StoryRuntime(project.Programs[storyId], adapter, storyId);
runtime.Locale = "zh-CN";
runtime.SendSignal("sig_boss_slain", new JObject { ["bossId"] = "red_dragon" });
await runtime.RunAsync(PlaybackMode.Manual, cancellationToken);
```

The APIs accept standalone `story-runtime` version 7 and
`story-blueprint-compiled-project` version 1. `StoryProgram.ParseProject(json, storyId)` selects a
program; use the selected story ID in the runtime constructor when loading an envelope.
Unknown fields are retained, while invalid versions, instruction/expression kinds, references,
types and control flow fail with `StoryRuntimeException`. It exposes `Code`, `JsonPath`, `StoryId`,
`BlockId` and `InstructionId`. JSON numbers follow finite double semantics. No reflection-based
DTO deserialization or dynamic code generation is used.

`ExportStateJson` stores location, typed variables, chapter frames, output caches, pending
interaction, signal inbox, locale and retryable external writes in `unity-story-state` version 1.
Cancel and await the current `RunAsync` before calling `RestoreStateJson`; then call `RunAsync`
again to re-present its pending interaction. Cancellation preserves the pause and prevents late
adapter completion from advancing it. The host provides `PlayAsync(savedJson)` to perform this
sequence. Saves must match Story ID, Program ID and content version. Incompatible saves are
rejected; no implicit migration or progress reset occurs. Persist the game-owned data alongside
the runtime snapshot.

`SendSignal` buffers unmatched payloads and wakes matching waits, including signals arriving
before their instruction. Matched payloads are consumed once and exposed through signal-output
expressions. An optional `SignalHandler` can connect to an existing game signal bus.

## Independent Story instances

`start-story`, `switch-story`, `resume-story` and `end-story-instance` call `StoryController` on
`UnityStoryAdapter`. Implement your own game instance policy, or use `StoryInstanceManager` with
a `StoryProject` and an adapter factory (one adapter/presenter per instance). Its `ControlAsync`
routes nested Story Control automatically and binds initial arguments by variable ID or name.
Returned values are keyed by story variable ID. Nonwaiting starts immediately return an instance
ID; their lifetime belongs to the manager. `end` removes an instance after cancellation, and
`Dispose` cancels all owned runs. Inspect `TryDequeueBackgroundError` for asynchronous failures.

The manager's `switch` starts the target and advances the caller, matching the Runtime's host
control request contract. Use `TransitionHandler` for scene/focus transitions, or a custom
`StoryController` for a different ownership policy. Duplicate IDs, self-waits and wait cycles are rejected.
`PauseAllAsync`, `ExportStateJson` and `RestoreStateJson` support registry saves in
`unity-story-session` version 1; restored instances remain paused until resumed.

## Validation and supported scope

```powershell
dotnet run --project integrations/unity/tests/StoryBlueprint.OfflineTests.csproj
npm test -- integrations/unity/tests/nativeRuntimeParity.test.ts
```

The offline runner links the exact Core source and NUnit test cases, uses the .NET 9 SDK's
Newtonsoft assembly (override `-p:NewtonsoftJsonPath=...` if needed), and downloads no NuGet
packages. CI runs it on Ubuntu and Windows. Unity imports the same Core tests as EditMode tests;
`Tests/PlayMode` verifies the real presenter and dispatcher. Add
`"testables": ["com.storyblueprint.runtime"]` to your project's package manifest to discover them.
The checked-in demo already enables package tests. Core fixtures also run through the TypeScript
compiler/runtime to check matching traces and values.

Supported native instructions include Dialogue, Narration, Choice, Branch, Jump, Set Variable
(including append/map entry/object field), Call Event, Wait Signal, Call Chapter, Return, Story
Control and End Story. Typed expressions, Array/Map/JSON/struct/enum values, localized text and
voice IDs are implemented. **Ink Block is rejected at load with `UNSUPPORTED_INSTRUCTION`.**
Ink C# interoperability remains a separate feature.

Unity 2022.3 and .NET Standard 2.1 are the baseline. Windows compiler/test results and platform
build evidence are recorded in [the implementation plan](../../docs/unity-adapter-plan.md).
Android/WebGL URL-based StreamingAssets loading is implemented; device/browser builds and
additional Unity LTS versions require their own platform validation before release.

## Next development steps

Publishing is deferred as of 2026-10-09. The next deliverable is Windows IL2CPP validation plus
a disk-backed save example that survives Player restart and keeps game variables consistent with
the runtime snapshot. Then add a replaceable production UI/resource example, multi-story scene
lifecycle integration, and repeatable Unity validation. Other Unity versions/platforms and Ink C#
compatibility follow as separate work.

Priorities, deliverables and acceptance criteria are tracked in
[the next-step plan](../../docs/unity-adapter-plan.md#下一步开发顺序2026-10-09).
