# Story Blueprint Unity Adapter

Unity 2022.3 LTS adapter, maintained directly in the RuntimeDemo project's `Assets` tree.
The pure C# `StoryBlueprint.Runtime` assembly executes native Blueprint instructions;
`StoryBlueprint.Unity` connects them to
the Unity main thread, presentation and game callbacks. Runtime code does not depend on UnityEditor.

## Install and run

The adapter source is inside this project at `samples/RuntimeDemo/Assets/StoryBlueprintAdapter`;
there is no external `file:` package link or duplicated source tree. Open `samples/RuntimeDemo`
with Unity 2022.3. Its manifest declares Newtonsoft JSON and uGUI. To make the distributable,
wait for Unity to compile, select `Assets/StoryBlueprintAdapter` in the Project window, choose
**Assets → Export Package**, keep **Include dependencies** enabled, verify that
`Runtime/Demo/StoryBlueprintStoryPlayer.prefab` and the Runtime/Editor scripts are selected, and
save as `StoryBlueprintAdapter.unitypackage`. This is Unity's native export and includes the
asset metadata needed by the importing project.
Save the native export to `integrations/unity/StoryBlueprintAdapter.unitypackage` for release.
Run `npm run release:unity` from the repository root to validate it against the current source
and stage the unchanged archive and SHA-512 metadata in `release/`. `npm run deploy:unity`
validates and uploads the Unity archive, metadata and portal page. The full deployment command
`npm run deploy -- --portal` also includes these files.
The target project must also have `com.unity.nuget.newtonsoft-json` 3.2.1 and `com.unity.ugui`
installed through Package Manager. Unity's `.unitypackage` export does not add UPM dependencies
to the target project's manifest.
After import, open `Assets/StoryBlueprintAdapter/Runtime/Demo/SBDemoScene.unity` or place
`Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintRuntimeDemo.prefab` in your own scene.
For a story-agnostic player UI, use `Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintStoryPlayer.prefab`;
the JSON importer adds this prefab and the generated Host together to the open scene.

Open `samples/RuntimeDemo` with Unity 2022.3 and play `Assets/Scenes/SampleScene.unity`.
The scene uses `Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintRuntimeDemo.prefab`.
You can also drag that prefab into another scene. Its Canvas, panels, text and buttons are
ordinary uGUI objects that can be edited in the Prefab editor. The prefab, its scripts and compiled dragon
quest are all in the package. Continue reveals typing text first, then advances. Both manual and auto
playback wait for a choice. Accept the quest, click **Defeat the red dragon**, and the fake
`ev_grant_reward` handler returns the stable `evo_success` output. The demo also supports
cancel, restart and saving/loading the current pause with its game gold value.

## Game integration

The normal import path is the dockable **Story Blueprint** Editor panel. It opens automatically
when the package loads in the Unity Editor. If you close it, select a Story Host in the scene
and click **Open Story Import Panel** in its Inspector.

1. In Story Blueprint, build the project to a compiled `.storyc.json` file.
2. In Unity, open the Story Blueprint panel, select that file, review its
   External Functions and Signals, then click **Import, Generate Host, and Add to Scene**.
3. Unity copies the JSON to `Assets/StoryBlueprintStories`, creates a typed Host script in
   `Assets/StoryBlueprintGenerated`, and adds the editable `StoryBlueprintStoryPlayer` UI prefab
   with a configured Host to the open scene after the script compiles. You can turn off
   **Play On Start** before importing.
4. Open the generated script and implement each External Function stub. The generated Signal
   methods are ready for game code to call when those signals occur.

External Function stubs deliberately throw `NotImplementedException` until implemented. The
generated Host is attached to the generic player prefab, which supplies its `UnityStoryPresenter`
and `UnityMainThreadDispatcher`. The player UI renders any story's dialogue, narration and choice
options; it contains no dragon-quest variable, Signal, or External Function assumptions. Edit the
prefab to change its layout, art or typography. The Inspector-based binding UI remains available
as an alternative.

For fully manual setup, add `UnityStoryHost` to a scene object and assign a compiled `TextAsset`
or StreamingAssets path in the Inspector. For game handlers, subclass the host and override
`ConfigureAdapter`:

```csharp
protected override void ConfigureAdapter(UnityStoryAdapter adapter)
{
    adapter.RegisterExternalFunction("ev_grant_reward", (request, token) =>
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

The `UnityStoryHost` Inspector can list the manifest in Unity. Assign a compiled project or
standalone story `TextAsset`, then choose one of two integration styles:

- Click **Generate C# Host** to create an editable `UnityStoryHost` subclass. It registers a handler
  stub for every External Function and adds a typed `SendSignal_*` method for every Signal. Fill in
  game-specific behavior in that file and attach the generated host to a GameObject with a
  `UnityStoryPresenter`. You do not need to make or drag a separate MonoBehaviour for each entry.
  Generated method names use each definition's readable `name`; stable IDs are kept in named
  constants for runtime registration. Generated External Function stubs throw
  `NotImplementedException` until implemented. Inputs and outputs use `string`, `double`, and
  `bool` for those primitive types; other types use `JToken`. A function with no outputs returns
  `Task`, one output returns `Task<T>`, and multiple outputs return a generated result class, so
  game logic does not need to read or build a `JObject` itself.
- Click **Refresh Bindings** to use the Inspector mapping UI. Drag a component implementing
  `IUnityStoryExternalFunctionHandler` into each External Function row and a component implementing
  `IUnityStorySignalSource` into each Signal row. Signal sources return an `IDisposable` subscription.

This keeps stable IDs in the compiled project while the game supplies the actual behavior. The
manifest is stored as `events` in compiled JSON for compatibility, but is presented as External
Functions in Unity. For standalone story JSON, the Inspector derives the IDs and used parameters
from `call-event` and `wait-signal` instructions; the compiled project envelope provides the full
declarations.

```csharp
public sealed class GrantReward : MonoBehaviour, IUnityStoryExternalFunctionHandler
{
    public Task<JObject> InvokeAsync(EventRequest request, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var amount = request.Arguments.Value<int>("amount");
        GivePlayerGold(amount);
        return Task.FromResult(new JObject { ["evo_success"] = true });
    }
}
```

For a Signal, implement `Subscribe(Action<JObject>)` by connecting to your game event bus and return
an `IDisposable` that removes the listener. Invoke the callback with the parameter payload when the
game event occurs. The host forwards it under the Signal ID shown in the Inspector. The story runtime
checks it against wait conditions and, for a compiled project, the declared parameter types.
`UnityStoryHost.SendSignal(id, payload)` is also available for direct code integration.

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

`UnityStoryPresenter` owns presentation state and input, but draws no UI. For custom UI,
implement `IStoryPresenter` or subclass `UnityStoryPresenter` and subscribe to
`DialoguePresented`, `NarrationPresented`, `ChoicePresented` and `InteractionCleared`.
Complete interactions through `Advance`, `RevealText` and `SelectChoice`.
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
the Test Framework package in the project to discover them. The checked-in demo already includes
that package. Core fixtures also run through the TypeScript compiler/runtime to check matching
traces and values.

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
