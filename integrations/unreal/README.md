# Story Blueprint Unreal Adapter (initial slice)

The source plugin is in `StoryBlueprint/`. The demonstration host is the existing
`D:\Unreal_Projects\StoryBlueprintDemo` UE 5.5 C++ project. The plugin uses only
long-standing UE5 modules (`Core`, `CoreUObject`, `Engine`, `InputCore`, `Json`) and
does not use version-specific preprocessor branches. This is a compatibility design,
not a claim that every UE5 release has been compiled or tested.

## Run the sample

Open `StoryBlueprintDemo.uproject`, compile the Editor target, and start Play in
Editor. Click the viewport to give it keyboard focus. The existing project map is
used; the sample GameMode creates a controller and prints prompts on screen.
The engine automation test `StoryBlueprint.SampleQuest` runs both branches and
checks the signal and event interactions without entering Play mode.

- Space: continue dialogue
- 1 / 2: accept or decline the quest
- K: send the `sig_boss_slain` signal with `bossId=red_dragon`
- R: restart

On the accepted path, the sample handles `ev_grant_reward` and returns
`{"evo_success":true}`. It logs a fake 500-gold grant. No game save or real
inventory is modified.

Game code can replace the sample controller and call `UStoryBlueprintSubsystem`:
`LoadStory`, `StartStory`, `Advance`, `ChooseOption`, `SendSignal`, and
`CompleteEvent`. `GetMessage`, `GetChoiceLabels`, `GetPendingEventId`, and
`GetPendingEventArgumentsJson` provide the current interaction. `GetLastError`
contains a fail-fast diagnostic.

## Supported boundary

The initial executor accepts standalone `story-runtime@7` files and supports
`jump`, `dialogue`, `narration`, `choice`, `set-variable`, `wait-signal`,
`call-event`, and `end-story`. Expressions are limited to literals and story
variables; text supports literal and expression parts. Event outputs are
validated by stable output ID. The minimal screen display does not render
speaker portraits, voice, or tags. Choice conditions, complex expressions, project
envelopes, chapters, substory control, Ink, early signal inbox, external
variables, localization, save/restore, and packaged-build staging are future
work. Unsupported instructions and constructs fail at load rather than being
silently skipped. This plugin is a demonstrable first slice, not yet a full
replacement for the TypeScript runtime.

The bundled JSON fixture is
[`docs/examples/sample-quest.storyc.json`](../../docs/examples/sample-quest.storyc.json).
The engine copy belongs at `Content/StoryBlueprint/sample-quest.storyc.json`.
