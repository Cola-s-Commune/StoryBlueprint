# Story Blueprint Unreal Adapter (initial slice)

The source plugin is in `StoryBlueprint/`. The demonstration host is the existing
`D:\Unreal_Projects\StoryBlueprintDemo` UE 5.5 C++ project. The plugin uses only
long-standing UE5 modules (`Core`, `CoreUObject`, `Engine`, `Json`) and
does not use version-specific preprocessor branches. This is a compatibility design,
not a claim that every UE5 release has been compiled or tested.

## Run the sample

Open `StoryBlueprintDemo.uproject`, compile the Editor target, and start Play in
Editor. Click the viewport to give it keyboard focus. The existing project map is
used; the sample GameMode creates a controller and prints prompts on screen.
The engine automation tests under `StoryBlueprint` run both branches, signal and
event interactions, independent Host instances, and stale event completion checks.
Additional contract tests cover project entry selection, expressions, Branch,
filtered option metadata, and invalid artifact headers. Compilation and engine
test execution for these changes are performed by the developer.

- Space: continue dialogue
- 1 / 2: accept or decline the quest
- K: send the `sig_boss_slain` signal with `bossId=red_dragon`
- R: restart

On the accepted path, the sample handles `ev_grant_reward` and returns
`{"evo_success":true}`. It logs a fake 500-gold grant. No game save or real
inventory is modified.

## Architecture and game integration

The layers follow the Unity package's Core / Adapter / Host / Presenter split:

| Layer | Type | What game developers change |
| --- | --- | --- |
| Core | `FStoryBlueprintRuntime` | Execution is separate from World, Actors, input, and UI. Each instance owns its state. |
| Adapter | `UStoryBlueprintAdapter` | Register C++ game callbacks by stable event ID. |
| Host | `UStoryBlueprintHostComponent` | Configure the story path and autoplay; start, stop, send signals, and handle events. Each Host owns its own Runtime. |
| Presenter | `UStoryBlueprintPresenter` | Replace dialogue/choice display in C++ or a Blueprint component. |
| Sample | `SampleSource/StoryBlueprintDemo` | Project-owned GameMode, controller, debug presenter, and fake reward callback. |

`UStoryBlueprintSubsystem` remains a direct, single-instance access API for earlier
integrations. New game integration should use a Host on the game-owned Actor. The
Host does not share the subsystem's Runtime.

Add a Host and a Presenter component to the same Actor. Configure
`StoryRelativePath` relative to `Content`, and set `bPlayOnBeginPlay`. A C++ Host
subclass overrides `ConfigureAdapter` to call `RegisterEvent`. An unregistered event
broadcasts `OnEventRequested` and waits for game code to call
`CompleteEvent(Request.CompletionId, ResultJson)`. The result object uses stable
output IDs. Every event occurrence has a fresh `CompletionId`; callbacks from a
stopped or restarted story are rejected. `RequestId` is the stable instruction ID
and is not a business deduplication key.

Both standalone programs and compiled project files can be assigned to the Host.
For projects, leave `EntryStoryId` empty to use the exported `entryStoryId`, or set
it to the desired **Story ID** (the `stories` key, not the nested Program ID).
`GetSelectedStoryId` and `GetAvailableStoryIds` expose the successful selection.
The subsystem offers `LoadStoryById` for explicit selection. `FStoryBlueprintProject`
retains the project root and selected program for native integrations; it validates
the headers/content versions of every Story and the Runtime validates the selected
Story's supported instructions. An unsupported instruction in a different Story
does not prevent selecting a compatible Story.

The Host exposes `PlayStory`, `Advance`, `ChooseOption`, `ChooseOptionById`,
`SendSignal`, and `StopStory`. It reports dialogue, choices, signals, events,
completion, and failure through delegates. Stopping or destroying the Host clears
presentation, broadcasts `OnStopped`, and invalidates pending completions. The game owns cancellation
of any external operation it started; a stale completion cannot advance the Host.

For a custom UI, subclass `UStoryBlueprintPresenter` and implement
`PresentDialogue`, `PresentChoice`, and `ClearPresentation`. Dialogue and choice
requests are reflected structs containing text, stable IDs, and a per-occurrence
`CompletionId`. Dialogue metadata includes Text ID, speaker, portrait, voice,
emotion, and tags for game-owned resource resolvers. C++ overrides their
`_Implementation` methods; Blueprint components can override the same events.
`GetStoryHost()` provides the owning Actor's Host for Continue and choice buttons.
UI should call `CompleteDialogue(Request.CompletionId)` or
`CompleteChoice(Request.CompletionId, Option.Id)` so delayed callbacks from old
widgets are rejected. Hidden options are omitted; visible disabled options carry
`bEnabled=false`. UI should keep them visible with input disabled. Choosing a hidden
or disabled ID returns false and preserves the active request. A choice with no
visible enabled options fails explicitly, following the Unity Presenter boundary.
Use one Host/Presenter pair per Actor. Clear pending widgets,
animations, and callbacks when `ClearPresentation` is called.
Host, Adapter, and Presenter calls belong on the game thread.

Blueprint integration is optional. No Blueprint assets are required by the plugin
or sample. A future UMG sample can implement the same Presenter contract. The
current event bridge uses JSON arguments/results; typed Host generation, as in
Unity, remains future editor tooling.

## Supported boundary

The executor accepts `story-runtime@7` and `story-blueprint-compiled-project@1`.
Supported instructions are `jump`, `branch`, `dialogue`, `narration`, `choice`,
`set-variable`, `wait-signal`, `call-event`, and `end-story`. Typed expressions
support literals, story variables, unary/binary operators, short-circuit `and`/`or`,
member/index access, and conversion. Opaque Engine JSON remains opaque to member
and index expressions. Recursive scalar/container/struct/enum value contracts are
checked on defaults, evaluated expressions, assignments, and event results.
Non-finite arithmetic, invalid conversions, missing keys, and out-of-range indices
fail with a diagnostic. Text interpolation uses JavaScript-style number, null,
array, and object formatting. Text locale variants can be present in the artifact;
the current runtime renders the default source text.

Event results are validated by stable output ID. Every declared output is required,
even when no variable consumes it. All outputs and mapped target variables are
validated before the cache and variable writes are committed together. Extra result
keys are ignored. `event-output` expressions read the latest completed result of a
producer instruction; repeated calls replace that instruction's cache after success.
`signal-output` reads the full payload consumed by a particular Wait instruction,
using parameter names. References to missing producers or declared outputs fail at
load; reading an output before its producer completes fails during execution.

After `PlayStory`, `SendSignal` accepts signals during any active interaction.
Native Core callers can also send after `LoadStory` and before the first
`StartStory`. A true result means accepted, including buffered, and does not imply
the story advanced. Each Wait consumes the oldest matching payload exactly once,
leaving nonmatching payloads for later Waits. Match fields form top-level constraints;
nested objects compare by keys and values, arrays by ordered values. Matches are
evaluated once when the Wait is reached. Project payloads require all manifest
parameters with valid types; extra fields are retained. Invalid payloads fail the
story before enqueueing. Standalone programs lack a signal manifest and check output
types when read. Restart, reload, and Host stop clear inboxes and output caches.
Signals sent before loading/playing or after completion/failure are rejected.
`GetPendingSignalMatchesJson` exposes the evaluated pending constraints;
`GetDebugSnapshotJson` exposes variables, output caches, and inbox for inspection.
The snapshot is not a versioned save format and has no restore API.

The minimal screen display does not render speaker portraits, voice, or tags.
Container mutation instructions, chapters, substory control/output expressions, Ink,
external variables, locale selection, save/restore, and
packaged-build staging remain future work. Selected stories using project/character
variable scopes are explicitly rejected until external-variable bridging is implemented.
Unsupported execution constructs fail at load. This is still a partial native
executor rather than complete TypeScript/Unity feature parity.

The bundled JSON fixture is
[`docs/examples/sample-quest.storyc.json`](../../docs/examples/sample-quest.storyc.json).
The engine copy belongs at `Content/StoryBlueprint/sample-quest.storyc.json`.

`Fixtures/conditional-project.storyc.json` is a two-Story contract sample. Set the
Host path to `StoryBlueprint/Fixtures/conditional-project.storyc.json`; the default
entry shows one locked option and one enabled option, and `s_alternate` tests a
different entry. `Fixtures/expression-cases.json` contains the shared expression
vectors used by UE automation and `tests/unrealRuntimeContract.test.ts`.
`Fixtures/event-signal-project.storyc.json` adds `s_flow` (buffered red/blue signals,
Event writeback, and output interpolation) and `s_repeat` (the same Event producer
called repeatedly). For `s_flow`, send `sig_enemy` payloads with `bossId` (`red` or
`blue`), numeric `score`, and `detail={"tags":[1,2],"meta":{"zone":"cave"}}`.
Handle `ev_reward` with all three results, for example
`{"evo_amount":500,"evo_status":"ok","evo_success":true}`. This fixture is intended
for custom Host integration and automation; the default dragon sample keys and
reward handler remain specific to the default quest.
`scripts/generate-contract-fixtures.cjs` regenerates all three fixture files.

After rebuilding the Editor target, run the `StoryBlueprint` automation group:
`SampleQuest`, `HostLifecycle`, `ProjectConditions`, `Expressions`, and
`ProjectValidation`, `EventSignalOutputs`, and `OutputValidation`. The new output
tests cover queue ordering/consumption, deep matching, cache replacement, stale
completion tokens, atomic writeback failure, and invalid output references.
No engine compilation, automation, or TypeScript test execution was performed
by the agent for this iteration, per the developer's workflow preference.
