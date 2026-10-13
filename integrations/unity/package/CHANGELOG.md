# Changelog

## 0.1.0

- Load validated native Runtime v7 programs and compiled project v1 envelopes.
- Execute native instructions, typed expressions, localized text, events, buffered signals,
  chapter calls, external variables and independent Story instances.
- Save and restore versioned runtime/session states with strict content checks.
- Add main-thread Unity callbacks, cancellable manual/auto presentation and a playable
  RuntimeDemo with editable uGUI prefab, scripts and compiled story in the package.
- Add an Inspector manifest scanner and component bindings for External Functions and Signals.
- Generate an editable C# UnityStoryHost from a compiled project or standalone story JSON, with
  readable typed External Function stubs, multi-output result classes, typed Signal methods and
  stable IDs stored as named constants.
- Add a dockable Story Blueprint import panel that opens when the Editor loads to import a compiled project,
  generate its typed Host script, and add/configure the Host in the current scene after compilation.
- Add an editable generic Story Player prefab for imported stories, with dialogue, narration,
  dynamic choices, playback, cancellation and in-memory save/restore controls.
- Buffer Signals delivered before the host loads its runtime.
- Add shared TypeScript/C# conformance fixtures, offline Core tests and Unity presenter tests.
- Reject Ink Block explicitly until Ink C# integration is implemented.
