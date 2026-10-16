using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace StoryBlueprint.Runtime.Tests
{
    public sealed class StoryRuntimeTests
    {
#if !STORYBLUEPRINT_OFFLINE
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator PublishedQuestAcceptsBufferedSignalAndCallsReward_Unity() => AwaitUnity(PublishedQuestAcceptsBufferedSignalAndCallsReward());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator PublishedQuestDeclineSkipsSignalAndEvent_Unity() => AwaitUnity(PublishedQuestDeclineSkipsSignalAndEvent());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator NativeFixtureMatchesTypeScriptTraceAndState_Unity() => AwaitUnity(NativeFixtureMatchesTypeScriptTraceAndState());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator SelectsCompiledProjectStoryAndRetainsResourceManifest_Unity() => AwaitUnity(SelectsCompiledProjectStoryAndRetainsResourceManifest());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InvalidOrDisabledChoiceFailsWithoutAdvancing_Unity() => AwaitUnity(InvalidOrDisabledChoiceFailsWithoutAdvancing());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator EventOutputsUseStableIdsAndRejectInvalidTypes_Unity() => AwaitUnity(EventOutputsUseStableIdsAndRejectInvalidTypes());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator SignalBufferMatchesPayloadAndSurvivesSaveRestore_Unity() => AwaitUnity(SignalBufferMatchesPayloadAndSurvivesSaveRestore());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator LiveSignalFinishesPendingWaitAndSkipsNonmatchingPayload_Unity() => AwaitUnity(LiveSignalFinishesPendingWaitAndSkipsNonmatchingPayload());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator CancelledPresentationCanRestartWithoutStaleCompletion_Unity() => AwaitUnity(CancelledPresentationCanRestartWithoutStaleCompletion());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator PendingChoiceSaveRestoresExactLocationAndRejectsOtherContent_Unity() => AwaitUnity(PendingChoiceSaveRestoresExactLocationAndRejectsOtherContent());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator ChapterParametersLocalsOutputsAndPendingFrameRestore_Unity() => AwaitUnity(ChapterParametersLocalsOutputsAndPendingFrameRestore());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator ExternalVariablesHydrateWriteAndRetryFailedPersistence_Unity() => AwaitUnity(ExternalVariablesHydrateWriteAndRetryFailedPersistence());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InvalidExternalHydrationFailsBeforeInstructions_Unity() => AwaitUnity(InvalidExternalHydrationFailsBeforeInstructions());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator StoryControlDispatchesAllOperationsAndMapsResults_Unity() => AwaitUnity(StoryControlDispatchesAllOperationsAndMapsResults());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator TightLoopReturnsDiagnosticInsteadOfHanging_Unity() => AwaitUnity(TightLoopReturnsDiagnosticInsteadOfHanging());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator PendingSignalRestoreRetainsMatchesAndConsumesOnlyOnce_Unity() => AwaitUnity(PendingSignalRestoreRetainsMatchesAndConsumesOnlyOnce());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator FailedExternalWritesSurviveSaveRestoreAndRetryWithoutRehydrating_Unity() => AwaitUnity(FailedExternalWritesSurviveSaveRestoreAndRetryWithoutRehydrating());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerOwnsBackgroundLifetimeAndEndCancellation_Unity() => AwaitUnity(InstanceManagerOwnsBackgroundLifetimeAndEndCancellation());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerRejectsDuplicatesAndDisposalCancelsPresenters_Unity() => AwaitUnity(InstanceManagerRejectsDuplicatesAndDisposalCancelsPresenters());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerSessionPauseRestoreAndResumePreservesArguments_Unity() => AwaitUnity(InstanceManagerSessionPauseRestoreAndResumePreservesArguments());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerBackgroundFailuresAreObservedAndInspectable_Unity() => AwaitUnity(InstanceManagerBackgroundFailuresAreObservedAndInspectable());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerRoutesNativeStoryControlAndReturnsChildVariables_Unity() => AwaitUnity(InstanceManagerRoutesNativeStoryControlAndReturnsChildVariables());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerRejectsSelfAwaitWithoutDeadlocking_Unity() => AwaitUnity(InstanceManagerRejectsSelfAwaitWithoutDeadlocking());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator DateLikeStringSurvivesRuntimeAndSessionSaveRestore_Unity() => AwaitUnity(DateLikeStringSurvivesRuntimeAndSessionSaveRestore());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator CorruptedEventResultsAndExternalWriteSnapshotsAreRejected_Unity() => AwaitUnity(CorruptedEventResultsAndExternalWriteSnapshotsAreRejected());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerInvokesSwitchTransitionBeforeTargetPresentation_Unity() => AwaitUnity(InstanceManagerInvokesSwitchTransitionBeforeTargetPresentation());
        [UnityEngine.TestTools.UnityTest]
        public System.Collections.IEnumerator InstanceManagerRejectsCircularWaitBetweenTwoStories_Unity() => AwaitUnity(InstanceManagerRejectsCircularWaitBetweenTwoStories());
        private static System.Collections.IEnumerator AwaitUnity(Task task)
        {
            while (!task.IsCompleted) yield return null;
            task.GetAwaiter().GetResult();
        }
#endif

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task PublishedQuestAcceptsBufferedSignalAndCallsReward()
        {
            var adapter = new RecordingAdapter { Choice = request => Task.FromResult("opt_accept") };
            var runtime = new StoryRuntime(StoryProgram.ParseProject(Fixture("sample-quest.storyc.json")), adapter);
            runtime.SendSignal("sig_boss_slain", new JObject { ["bossId"] = "other" });
            runtime.SendSignal("sig_boss_slain", new JObject { ["bossId"] = "red_dragon" });
            await Within(runtime.RunAsync());
            Check(runtime.IsCompleted, "Quest should finish after matching buffered signal.");
            Equal(runtime.Variables["v_quest_accepted"], new JValue(true));
            Check(adapter.Dialogues.Single().Text == "Welcome to our village, Hero! We desperately need your help.", "Published text interpolation differs.");
            Check(adapter.Events.Single().EventId == "ev_grant_reward", "Reward event was not called.");
            Equal(adapter.Events[0].Arguments["amount"], new JValue(500));
            Check(adapter.SignalCalls == 0, "Buffered signal must avoid calling the host wait.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task PublishedQuestDeclineSkipsSignalAndEvent()
        {
            var adapter = new RecordingAdapter { Choice = request => Task.FromResult("opt_decline") };
            var runtime = new StoryRuntime(StoryProgram.ParseProject(Fixture("sample-quest.storyc.json")), adapter);
            await Within(runtime.RunAsync(PlaybackMode.Automatic));
            Check(runtime.IsCompleted && adapter.Events.Count == 0 && adapter.SignalCalls == 0, "Decline must finish directly.");
            Check(adapter.Modes.Single() == PlaybackMode.Automatic, "Playback mode must reach the presenter.");
            Equal(runtime.Variables["v_quest_accepted"], new JValue(false));
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task NativeFixtureMatchesTypeScriptTraceAndState()
        {
            var adapter = new RecordingAdapter
            {
                Choice = request => Task.FromResult("opt_yes"),
                Event = request => Task.FromResult(new JObject { ["evo_reward"] = 7 })
            };
            var runtime = new StoryRuntime(StoryProgram.ParseProject(Fixture("native-conformance.storyc.json")), adapter) { Locale = "zh-CN" };
            runtime.SendSignal("sig_ready", new JObject { ["bossId"] = "red_dragon", ["amount"] = 3 });
            await Within(runtime.RunAsync());
            Check(runtime.IsCompleted, "Native fixture did not complete.");
            Equal(runtime.Variables["v_score"], new JValue(17));
            Equal(runtime.Variables["v_items"], new JArray(2, 5));
            Equal(runtime.Variables["v_map"], new JObject { ["reward"] = 7 });
            Equal(runtime.Variables["v_profile"], new JObject { ["level"] = 2, ["name"] = "Hero" });
            Check(adapter.Dialogues.Single().Text == "你好 Hero，分数 17", "Localized fixture trace differs.");
            Check(adapter.Dialogues[0].SpeakerId == "c_hero" && adapter.Dialogues[0].VoiceAssetId == "a_voice_zh" && adapter.Dialogues[0].PortraitId == "a_portrait" && adapter.Dialogues[0].Emotion == "happy", "Stable resource IDs or locale voice fallback were lost.");
            Check(adapter.Narrations.Single().Text == "Finished 17", "Narration trace differs.");
            Check(adapter.Choices.Single().Options.Count == 2, "Hidden option must not be presented.");
            Check(!adapter.Choices[0].Options.Single(option => option.Id == "opt_disabled").Enabled, "Disabled choice must stay disabled.");
            Equal(adapter.Events.Single().Arguments, new JObject { ["amount"] = 5 });
        }

        [Test]
        public void RejectsUnsupportedVersionsAndInkWithStructuredPaths()
        {
            var unsupported = Minimal(); unsupported["version"] = 6;
            var error = Throws(() => StoryProgram.Parse(unsupported.ToString()));
            Check(error.Code == "UNSUPPORTED_RUNTIME_VERSION" && error.JsonPath == "$.version", "Unsupported version must include a code and JSON path.");
            var ink = Minimal(Instruction("i_ink", "ink-block", "inkJson", "{}", "variableBindings", new JArray()), End());
            error = Throws(() => StoryProgram.Parse(ink.ToString()));
            Check(error.Code == "UNSUPPORTED_INSTRUCTION" && error.InstructionId == "i_ink", "Ink must fail before execution with its instruction ID.");
            Check(error.JsonPath.Contains("instructions"), "Ink diagnostic must locate the instruction.");
        }

        [Test]
        public void RejectsMissingTargetsAndUnknownExpressionsBeforeExecution()
        {
            var missing = Minimal(Instruction("i_jump", "jump", "target", "b_missing"));
            Check(!string.IsNullOrEmpty(Throws(() => StoryProgram.Parse(missing.ToString())).JsonPath), "Missing target must have a path.");
            var invalid = Minimal(Instruction("i_set", "set-variable", "variableId", "v_score", "value", new JObject { ["kind"] = "eval-csharp" }), End());
            Variables(invalid, Variable("v_score", "number", 0));
            Check(!string.IsNullOrEmpty(Throws(() => StoryProgram.Parse(invalid.ToString())).JsonPath), "Unsupported AST must have a path.");
        }

        [Test]
        public void EvaluatorPreservesContainerIdentityAndShortCircuitsLogicalExpressions()
        {
            var shared = new JObject { ["amount"] = 4 };
            Func<string, JToken> reader = id => id == "v_payload" ? shared : throw new InvalidOperationException("Unreachable operand evaluated");
            Equal(StoryEvaluator.Evaluate(Binary("equal", Ref("v_payload", "any"), Ref("v_payload", "any")), reader), new JValue(true));
            var first = new JObject { ["kind"] = "literal", ["value"] = shared.DeepClone(), ["valueType"] = Type("any") };
            var second = new JObject { ["kind"] = "literal", ["value"] = shared.DeepClone(), ["valueType"] = Type("any") };
            Equal(StoryEvaluator.Evaluate(Binary("equal", first, second), reader), new JValue(false));
            Equal(StoryEvaluator.Evaluate(Binary("and", Literal(false), Ref("v_unreachable", "boolean")), reader), new JValue(false));
            Equal(StoryEvaluator.Evaluate(Binary("or", Literal(true), Ref("v_unreachable", "boolean")), reader), new JValue(true));
            Check(StoryEvaluator.DeepEquals(shared, (JObject)shared.DeepClone()), "Signal matching must retain structural comparison despite strict expression equality.");
        }

        [Test]
        public void EvaluatorConversionsPreserveJavaScriptRadixTruthinessAndArrayText()
        {
            foreach (var pair in new[] { new KeyValuePair<string, double>("0b101", 5), new KeyValuePair<string, double>("0o17", 15), new KeyValuePair<string, double>("0xffffffffffffffff", 18446744073709551615d), new KeyValuePair<string, double>(" \uFEFF ", 0) })
            {
                var expression = new JObject { ["kind"] = "convert", ["target"] = Literal(pair.Key), ["to"] = Type("number"), ["valueType"] = Type("number") };
                Equal(StoryEvaluator.Evaluate(expression, null), new JValue(pair.Value));
            }
            var opaque = new JObject { ["kind"] = "literal", ["value"] = new JObject(), ["valueType"] = Type("any") };
            Equal(StoryEvaluator.Evaluate(new JObject { ["kind"] = "convert", ["target"] = opaque, ["to"] = Type("boolean"), ["valueType"] = Type("boolean") }, null), new JValue(true));
            Check(StoryEvaluator.FormatValue(new JArray(JValue.CreateNull(), true, 5)) == ",true,5", "Array String conversion differs from Blueprint/JavaScript.");
        }

        [Test]
        public void EvaluatorRejectsNonfiniteNumbersAndInvalidArrayIndices()
        {
            Check(Throws(() => StoryEvaluator.Evaluate(Binary("divide", Literal(1), Literal(0)), null)).Code == "INVALID_EXPRESSION", "Nonfinite number must reject before entering variables or saves.");
            var array = new JObject { ["kind"] = "literal", ["value"] = new JArray(4), ["valueType"] = Type("array") };
            foreach (var index in new[] { -1d, 0.5d, 1d })
            {
                var expression = new JObject { ["kind"] = "index", ["target"] = array.DeepClone(), ["index"] = Literal(index), ["valueType"] = Type("number") };
                Check(Throws(() => StoryEvaluator.Evaluate(expression, null)).Code == "INVALID_EXPRESSION", "Array index must be an in-range integer.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task SelectsCompiledProjectStoryAndRetainsResourceManifest()
        {
            var first = Minimal(); first["id"] = "p_first";
            var second = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_second", "Second story")), End()); second["id"] = "p_second";
            var envelope = Envelope(first, second);
            envelope["stories"]["s_second"]["characters"] = new JArray(new JObject { ["id"] = "c_hero", ["name"] = "hero", ["displayName"] = "Hero", ["emotions"] = new JObject() });
            envelope["stories"]["s_second"]["assets"] = new JArray(new JObject { ["id"] = "a_voice", ["name"] = "voice", ["displayName"] = "Voice", ["kind"] = "audio", ["uri"] = "game://voice" });
            var project = StoryProject.Parse(envelope.ToString());
            Check(project.Programs.Count == 2 && project.EntryStoryId == "s_first", "Project entry or Story collection was lost.");
            Check((string)project.Data["stories"]["s_second"]["characters"][0]["id"] == "c_hero" && (string)project.Data["stories"]["s_second"]["assets"][0]["uri"] == "game://voice", "Engine resource metadata must survive project parsing.");
            var adapter = new RecordingAdapter();
            var runtime = new StoryRuntime(StoryProgram.ParseProject(envelope.ToString(), "s_second"), adapter);
            await Within(runtime.RunAsync());
            Check(adapter.Dialogues.Single().Text == "Second story", "Explicit Story selection ignored.");
            Throws(() => StoryProgram.ParseProject(envelope.ToString(), "s_missing"));
            envelope["version"] = 2;
            Check(Throws(() => StoryProject.Parse(envelope.ToString())).Code == "UNSUPPORTED_PROJECT_VERSION", "Envelope version error should be precise.");
        }

        [Test]
        public void ProjectManifestsValidateEventArgumentsOutputsAndSignalParameters()
        {
            var eventProgram = EventProgram();
            eventProgram["blocks"]["b_entry"]["instructions"][0]["arguments"] = new JObject { ["amount"] = Literal(5) };
            var eventProject = Envelope(eventProgram, Minimal());
            eventProject["events"] = new JArray(new JObject
            {
                ["id"] = "ev_reward", ["name"] = "reward", ["displayName"] = "Reward", ["resumable"] = true, ["sideEffect"] = "write",
                ["parameters"] = new JArray(new JObject { ["name"] = "amount", ["valueType"] = Type("number") }),
                ["outputs"] = new JArray(new JObject { ["id"] = "out_reward", ["name"] = "amount", ["displayName"] = "Amount", ["valueType"] = Type("number") })
            });
            StoryProject.Parse(eventProject.ToString());
            var wrongArgument = (JObject)eventProject.DeepClone();
            wrongArgument["stories"]["s_first"]["program"]["blocks"]["b_entry"]["instructions"][0]["arguments"] = new JObject { ["unknown"] = Literal(5) };
            Check(Throws(() => StoryProject.Parse(wrongArgument.ToString())).Code == "INVALID_ARGUMENT", "Event arguments must match the manifest.");
            var wrongOutput = (JObject)eventProject.DeepClone(); wrongOutput["events"][0]["outputs"][0]["valueType"] = Type("string");
            Check(Throws(() => StoryProject.Parse(wrongOutput.ToString())).Code == "INVALID_OUTPUT", "Event outputs must match manifest stable IDs and types.");
            var signalProject = Envelope(SignalProgram(), Minimal());
            signalProject["signals"] = new JArray(new JObject { ["id"] = "sig_ready", ["name"] = "ready", ["displayName"] = "Ready", ["parameters"] = new JArray(new JObject { ["name"] = "bossId", ["valueType"] = Type("string") }, new JObject { ["name"] = "amount", ["valueType"] = Type("number") }) });
            StoryProject.Parse(signalProject.ToString());
            ((JArray)signalProject["signals"][0]["parameters"]).RemoveAt(1);
            Check(Throws(() => StoryProject.Parse(signalProject.ToString())).Code == "INVALID_EXPRESSION", "Signal output references must exist in the manifest.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InvalidOrDisabledChoiceFailsWithoutAdvancing()
        {
            foreach (var selected in new[] { "opt_missing", "opt_disabled" })
            {
                var program = ChoiceProgram();
                var adapter = new RecordingAdapter { Choice = request => Task.FromResult(selected) };
                var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
                var error = await ThrowsAsync(() => runtime.RunAsync());
                Check(error.Code == "INVALID_OPTION" && error.InstructionId == "i_choice", "Invalid choice result requires a precise adapter diagnostic.");
                Check(!runtime.IsCompleted && adapter.Dialogues.Count == 0, "Invalid choice advanced the program.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task EventOutputsUseStableIdsAndRejectInvalidTypes()
        {
            foreach (var response in new[] { new JObject { ["amount"] = 7 }, new JObject { ["out_reward"] = "wrong" } })
            {
                var adapter = new RecordingAdapter { Event = request => Task.FromResult(response) };
                var runtime = new StoryRuntime(StoryProgram.Parse(EventProgram().ToString()), adapter);
                var error = await ThrowsAsync(() => runtime.RunAsync());
                Check(error.Code == "INVALID_ADAPTER_RESULT" && error.InstructionId == "i_event", "Event contract violation requires adapter-result diagnostic.");
                Equal(runtime.Variables["v_score"], new JValue(0));
            }
            var valid = new StoryRuntime(StoryProgram.Parse(EventProgram().ToString()), new RecordingAdapter { Event = request => Task.FromResult(new JObject { ["out_reward"] = 7 }) });
            await Within(valid.RunAsync());
            Equal(valid.Variables["v_score"], new JValue(7));
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task SignalBufferMatchesPayloadAndSurvivesSaveRestore()
        {
            var program = SignalProgram();
            var initial = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            initial.SendSignal("sig_ready", new JObject { ["bossId"] = "other", ["amount"] = 99 });
            initial.SendSignal("sig_ready", new JObject { ["bossId"] = "red_dragon", ["amount"] = 3 });
            var adapter = new RecordingAdapter();
            var restored = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            restored.RestoreStateJson(initial.ExportStateJson());
            await Within(restored.RunAsync());
            Equal(restored.Variables["v_score"], new JValue(3));
            Check(adapter.SignalCalls == 0 && restored.IsCompleted, "Restored matching signal should be consumed locally.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task LiveSignalFinishesPendingWaitAndSkipsNonmatchingPayload()
        {
            var entered = NewCompletion<SignalRequest>();
            var pending = NewCompletion<JObject>();
            var adapter = new RecordingAdapter { Signal = request => { entered.TrySetResult(request); return pending.Task; } };
            var runtime = new StoryRuntime(StoryProgram.Parse(SignalProgram().ToString()), adapter);
            var running = runtime.RunAsync();
            await Within(entered.Task);
            runtime.SendSignal("sig_ready", new JObject { ["bossId"] = "other", ["amount"] = 99 });
            Check(!running.IsCompleted, "A nonmatching signal resumed the story.");
            runtime.SendSignal("sig_ready", new JObject { ["bossId"] = "red_dragon", ["amount"] = 3 });
            await Within(running);
            Equal(runtime.Variables["v_score"], new JValue(3));
            pending.TrySetResult(new JObject { ["bossId"] = "red_dragon", ["amount"] = 999 });
            Equal(runtime.Variables["v_score"], new JValue(3));
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task CancelledPresentationCanRestartWithoutStaleCompletion()
        {
            var firstEntered = NewCompletion<DialogueRequest>();
            var first = NewCompletion<bool>();
            var secondEntered = NewCompletion<DialogueRequest>();
            var second = NewCompletion<bool>();
            var calls = 0;
            var adapter = new RecordingAdapter
            {
                Dialogue = request => { calls++; if (calls == 1) { firstEntered.TrySetResult(request); return first.Task; } secondEntered.TrySetResult(request); return second.Task; }
            };
            var runtime = new StoryRuntime(StoryProgram.Parse(Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Hello")), End()).ToString()), adapter);
            using (var cancellation = new CancellationTokenSource())
            {
                var running = runtime.RunAsync(PlaybackMode.Manual, cancellation.Token);
                await Within(firstEntered.Task);
                cancellation.Cancel();
                await Cancelled(running);
            }
            var restarted = runtime.RunAsync();
            await Within(secondEntered.Task);
            first.TrySetResult(true);
            Check(!runtime.IsCompleted && !restarted.IsCompleted, "Stale presenter completion advanced a restarted story.");
            second.TrySetResult(true);
            await Within(restarted);
            Check(runtime.IsCompleted && calls == 2, "Restart must replay only the pending interaction.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task PendingChoiceSaveRestoresExactLocationAndRejectsOtherContent()
        {
            var entered = NewCompletion<ChoiceRequest>();
            var pending = NewCompletion<string>();
            var adapter = new RecordingAdapter { Choice = request => { entered.TrySetResult(request); return pending.Task; } };
            var program = ChoiceProgram();
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            string saved;
            using (var cancellation = new CancellationTokenSource())
            {
                var running = runtime.RunAsync(PlaybackMode.Manual, cancellation.Token);
                await Within(entered.Task);
                saved = runtime.ExportStateJson();
                cancellation.Cancel();
                await Cancelled(running);
            }
            var restoredAdapter = new RecordingAdapter { Choice = request => Task.FromResult("opt_yes") };
            var restored = new StoryRuntime(StoryProgram.Parse(program.ToString()), restoredAdapter);
            restored.RestoreStateJson(saved);
            await Within(restored.RunAsync());
            Check(restoredAdapter.Choices.Single().RequestId == "i_choice" && restoredAdapter.Dialogues.Single().Text == "Chosen", "Pending choice was not replayed from its saved location.");
            program["contentVersion"] = "changed";
            var incompatible = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            Check(!string.IsNullOrEmpty(Throws(() => incompatible.RestoreStateJson(saved)).Code), "Different content must reject the save.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task ChapterParametersLocalsOutputsAndPendingFrameRestore()
        {
            var entered = NewCompletion<DialogueRequest>();
            var pending = NewCompletion<bool>();
            var adapter = new RecordingAdapter { Dialogue = request => { entered.TrySetResult(request); return pending.Task; } };
            var program = ChapterProgram();
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            string saved;
            using (var cancellation = new CancellationTokenSource())
            {
                var running = runtime.RunAsync(PlaybackMode.Manual, cancellation.Token);
                await Within(entered.Task);
                saved = runtime.ExportStateJson();
                cancellation.Cancel();
                await Cancelled(running);
            }
            var restoredAdapter = new RecordingAdapter();
            var restored = new StoryRuntime(StoryProgram.Parse(program.ToString()), restoredAdapter);
            restored.RestoreStateJson(saved);
            await Within(restored.RunAsync());
            Equal(restored.Variables["v_score"], new JValue(12));
            Check(!restored.Variables.ContainsKey("v_param") && !restored.Variables.ContainsKey("v_local"), "Chapter locals leaked into story variables.");
            Check(restoredAdapter.Dialogues.Single().Text == "Inside", "Chapter pending dialogue was lost.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task ExternalVariablesHydrateWriteAndRetryFailedPersistence()
        {
            var program = Minimal(Instruction("i_set", "set-variable", "variableId", "v_score", "value", Binary("add", Ref("v_score", "number"), Literal(1))), End());
            Variables(program, Variable("v_score", "number", 0, "project"));
            var writes = new List<JToken>();
            var failWrite = true;
            var reads = 0;
            var adapter = new RecordingAdapter
            {
                Read = definition => { reads++; return Task.FromResult<JToken>(new JValue(4)); },
                Write = (definition, value) => { writes.Add(value.DeepClone()); if (failWrite) throw new InvalidOperationException("storage offline"); return Task.CompletedTask; }
            };
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            var error = await ThrowsAsync(() => runtime.RunAsync());
            Check(error.Code == "ADAPTER_ERROR", "Write failure must report adapter error.");
            Equal(runtime.Variables["v_score"], new JValue(5));
            failWrite = false;
            await Within(runtime.RetryExternalWritesAsync(CancellationToken.None));
            await Within(runtime.RunAsync());
            Check(runtime.IsCompleted && reads == 1 && writes.Count == 2, "Retry must persist the queued value without hydrating or replaying mutation.");
            Equal(writes[0], writes[1]);
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InvalidExternalHydrationFailsBeforeInstructions()
        {
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Hello")), End());
            Variables(program, Variable("v_score", "number", 0, "character"));
            var adapter = new RecordingAdapter { Read = definition => Task.FromResult<JToken>(new JValue("wrong")) };
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            var error = await ThrowsAsync(() => runtime.RunAsync());
            Check(error.Code == "INVALID_ADAPTER_RESULT" && adapter.Dialogues.Count == 0, "Invalid external value must fail before story side effects.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task StoryControlDispatchesAllOperationsAndMapsResults()
        {
            var program = Minimal(
                Instruction("i_start", "start-story", "storyId", "s_other", "instanceId", Literal("requested"), "arguments", new JObject { ["amount"] = Literal(4) }, "resultVariableIds", new JObject { ["result"] = "v_score" }, "instanceVariableId", "v_instance", "waitForCompletion", true),
                Instruction("i_switch", "switch-story", "storyId", "s_other", "instanceId", Ref("v_instance", "string"), "arguments", new JObject(), "resultVariableIds", new JObject(), "waitForCompletion", false),
                Instruction("i_resume", "resume-story", "instanceId", Ref("v_instance", "string"), "resultVariableIds", new JObject(), "waitForCompletion", true),
                Instruction("i_endinstance", "end-story-instance", "instanceId", Ref("v_instance", "string"), "resultVariableIds", new JObject()), End());
            Variables(program, Variable("v_score", "number", 0), Variable("v_instance", "string", ""));
            var controls = new List<StoryControlRequest>();
            var adapter = new RecordingAdapter { Control = request => { controls.Add(request); return Task.FromResult(new StoryControlResult { InstanceId = "generated", Values = new JObject { ["result"] = 9 } }); } };
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            await Within(runtime.RunAsync());
            Check(string.Join(",", controls.Select(request => request.Operation)) == "start,switch,resume,end", "Story control operation dispatch differs.");
            Check(controls[0].StoryId == "s_other" && controls[0].InstanceId == "requested" && controls[0].WaitForCompletion, "Start request lost arguments or wait policy.");
            Equal(controls[0].Arguments, new JObject { ["amount"] = 4 });
            Check(controls.Skip(1).All(request => request.InstanceId == "generated") && !controls[1].WaitForCompletion && !controls[3].WaitForCompletion, "Story instance result or wait policy lost.");
            Equal(runtime.Variables["v_score"], new JValue(9));
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task TightLoopReturnsDiagnosticInsteadOfHanging()
        {
            var runtime = new StoryRuntime(StoryProgram.Parse(Minimal(Instruction("i_loop", "jump", "target", "b_entry")).ToString()), new RecordingAdapter());
            var error = await ThrowsAsync(() => runtime.RunAsync());
            Check(error.Code == "TIGHT_LOOP" && error.InstructionId == "i_loop", "Tight-loop diagnostic must identify the instruction.");
        }

        [Test]
        public void TamperedSaveRejectsInvalidVariablesLocationsAndVersionsAtomically()
        {
            var program = Minimal(); Variables(program, Variable("v_score", "number", 0));
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            var original = runtime.ExportStateJson();
            foreach (var mutate in new Action<JObject>[] {
                save => save["storyVariables"]["v_score"] = "wrong",
                save => save["blockId"] = "b_missing",
                save => save["instructionIndex"] = -1,
                save => save["instructionIndex"] = 99,
                save => save["pending"] = new JObject { ["kind"] = "choice", ["instructionId"] = "i_missing", ["requestId"] = "i_missing" }
            })
            {
                var invalid = JObject.Parse(original); mutate(invalid);
                var error = Throws(() => runtime.RestoreStateJson(invalid.ToString()));
                Check(error.Code == "INVALID_STATE" || error.Code == "INVALID_LOCATION", "Tampered state must return a state or location diagnostic, got " + error.Code);
                Check(runtime.ExportStateJson() == original, "Failed restore modified the current state.");
            }
            var unsupported = JObject.Parse(original); unsupported["version"] = 2;
            Check(Throws(() => runtime.RestoreStateJson(unsupported.ToString())).Code == "STATE_VERSION_MISMATCH", "Unsupported save version must fail explicitly.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task PendingSignalRestoreRetainsMatchesAndConsumesOnlyOnce()
        {
            var entered = NewCompletion<SignalRequest>();
            var pending = NewCompletion<JObject>();
            var adapter = new RecordingAdapter { Signal = request => { entered.TrySetResult(request); return pending.Task; } };
            var program = SignalProgram();
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            string saved;
            using (var cancellation = new CancellationTokenSource())
            {
                var running = runtime.RunAsync(PlaybackMode.Manual, cancellation.Token);
                await Within(entered.Task);
                saved = runtime.ExportStateJson(); cancellation.Cancel(); await Cancelled(running);
            }
            var restored = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            var invalidMatches = JObject.Parse(saved); invalidMatches["pending"]["matches"]["bossId"] = 42;
            Check(Throws(() => restored.RestoreStateJson(invalidMatches.ToString())).Code == "INVALID_STATE", "Pending signal constraints must retain their declared types.");
            restored.RestoreStateJson(saved);
            restored.SendSignal("sig_ready", new JObject { ["bossId"] = "red_dragon", ["amount"] = 3 });
            await Within(restored.RunAsync());
            var final = JObject.Parse(restored.ExportStateJson());
            Equal(restored.Variables["v_score"], new JValue(3));
            Check(final["signalInbox"]["sig_ready"] == null, "Matched signal must be consumed exactly once.");
            Equal(final["signalOutputs"]["i_signal"], new JObject { ["bossId"] = "red_dragon", ["amount"] = 3 });
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task FailedExternalWritesSurviveSaveRestoreAndRetryWithoutRehydrating()
        {
            var program = Minimal(Instruction("i_set", "set-variable", "variableId", "v_score", "value", Literal(8)), End());
            Variables(program, Variable("v_score", "number", 0, "project"));
            var adapter = new RecordingAdapter { Write = (definition, value) => throw new InvalidOperationException("offline") };
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), adapter);
            await ThrowsAsync(() => runtime.RunAsync());
            var writes = new List<JToken>();
            var restoredAdapter = new RecordingAdapter
            {
                Read = definition => throw new InvalidOperationException("Restore must preserve hydration"),
                Write = (definition, value) => { writes.Add(value.DeepClone()); return Task.CompletedTask; }
            };
            var restored = new StoryRuntime(StoryProgram.Parse(program.ToString()), restoredAdapter);
            restored.RestoreStateJson(runtime.ExportStateJson());
            await Within(restored.RetryExternalWritesAsync());
            await Within(restored.RunAsync());
            Equal(writes.Single(), new JValue(8));
            Check(restored.IsCompleted, "Retry after load must recover external-write failure.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task DateLikeStringSurvivesRuntimeAndSessionSaveRestore()
        {
            const string stamp = "2026-10-08T12:34:56.789+08:00";
            var program = Minimal(); Variables(program, Variable("v_stamp", "string", stamp));
            var runtime = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            await Within(runtime.RunAsync());
            var restoredRuntime = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter());
            restoredRuntime.RestoreStateJson(runtime.ExportStateJson());
            Check(restoredRuntime.Variables["v_stamp"].Type == JTokenType.String && (string)restoredRuntime.Variables["v_stamp"] == stamp, "Runtime saves must preserve ISO-like strings exactly.");
            var project = StoryProject.Parse(Envelope(program, Minimal()).ToString());
            string session;
            using (var manager = new StoryInstanceManager(project, id => new RecordingAdapter()))
            {
                await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "date", WaitForCompletion = true });
                session = manager.ExportStateJson();
            }
            using (var restored = new StoryInstanceManager(project, id => new RecordingAdapter()))
            {
                restored.RestoreStateJson(session);
                var value = restored.GetRuntime("date").Variables["v_stamp"];
                Check(value.Type == JTokenType.String && (string)value == stamp, "Session snapshots must preserve ISO-like strings exactly.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task CorruptedEventResultsAndExternalWriteSnapshotsAreRejected()
        {
            var eventRuntime = new StoryRuntime(StoryProgram.Parse(EventProgram().ToString()), new RecordingAdapter { Event = request => Task.FromResult(new JObject { ["out_reward"] = 7 }) });
            await Within(eventRuntime.RunAsync());
            var missingOutput = JObject.Parse(eventRuntime.ExportStateJson());
            ((JObject)missingOutput["eventOutputs"]["i_event"]).Remove("out_reward");
            Check(Throws(() => eventRuntime.RestoreStateJson(missingOutput.ToString())).Code == "INVALID_STATE", "Saved events must retain every declared output.");
            var program = Minimal(Instruction("i_set", "set-variable", "variableId", "v_score", "value", Literal(8)), End());
            Variables(program, Variable("v_score", "number", 0, "project"));
            var external = new StoryRuntime(StoryProgram.Parse(program.ToString()), new RecordingAdapter { Write = (definition, value) => throw new InvalidOperationException("offline") });
            await ThrowsAsync(() => external.RunAsync());
            var inconsistentWrite = JObject.Parse(external.ExportStateJson());
            inconsistentWrite["pendingExternalWrites"]["v_score"] = 9;
            Check(Throws(() => external.RestoreStateJson(inconsistentWrite.ToString())).Code == "INVALID_STATE", "Pending writes must agree with their saved variable values.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerInvokesSwitchTransitionBeforeTargetPresentation()
        {
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Switched")), End());
            var order = new List<string>();
            var adapter = new RecordingAdapter { Dialogue = request => { order.Add("present"); return Task.CompletedTask; } };
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(program, Minimal()).ToString()), id => adapter))
            {
                manager.TransitionHandler = (request, token) => { order.Add(request.Operation + ":" + request.StoryId); Check(!token.IsCancellationRequested, "Transition must receive the active token."); return Task.CompletedTask; };
                var result = await manager.ControlAsync(new StoryControlRequest { Operation = "switch", StoryId = "s_first", InstanceId = "switch", WaitForCompletion = true });
                Check(result.InstanceId == "switch" && manager.GetRuntime("switch").IsCompleted, "Switch must complete the selected target.");
                Check(order.SequenceEqual(new[] { "switch:s_first", "present" }), "Scene/focus transition must precede target presentation.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerRejectsCircularWaitBetweenTwoStories()
        {
            var a = Minimal(Instruction("i_a_resume", "resume-story", "instanceId", Literal("b"), "resultVariableIds", new JObject(), "waitForCompletion", true), End());
            var b = Minimal(Instruction("i_b_gate", "dialogue", "text", Text("t_b", "B")), Instruction("i_b_resume", "resume-story", "instanceId", Literal("a"), "resultVariableIds", new JObject(), "waitForCompletion", true), End());
            b["id"] = "p_second";
            var bGate = NewCompletion<bool>();
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(a, b).ToString()), id => new RecordingAdapter { Dialogue = request => bGate.Task }))
            {
                await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_second", InstanceId = "b" });
                // A executes synchronously until its first incomplete await on B's gated presentation.
                var waitingA = manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "a", WaitForCompletion = true });
                Check(!waitingA.IsCompleted, "A must be waiting for B before B attempts to resume A.");
                bGate.TrySetResult(true);
                var error = await ThrowsAsync(async () => { await waitingA; });
                Check(error.Code == "INVALID_ADAPTER_RESULT" && error.Message.Contains("cycle"), "A waiting on B and B waiting on A must reject a circular wait.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerOwnsBackgroundLifetimeAndEndCancellation()
        {
            var entered = NewCompletion<DialogueRequest>();
            var adapter = new RecordingAdapter { Dialogue = request => { entered.TrySetResult(request); return NewCompletion<bool>().Task; } };
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Pending")), End());
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(program, Minimal()).ToString()), id => adapter))
            using (var caller = new CancellationTokenSource())
            {
                var result = await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "background", WaitForCompletion = false }, caller.Token);
                await Within(entered.Task);
                caller.Cancel();
                Check(result.InstanceId == "background" && result.Values.Count == 0, "Background start should return only the instance ID while pending.");
                Check(!adapter.LastToken.IsCancellationRequested, "Caller cancellation must not abandon manager-owned background instances.");
                var runtime = manager.GetRuntime("background");
                await Within(manager.ControlAsync(new StoryControlRequest { Operation = "end", InstanceId = "background" }));
                Check(adapter.LastToken.IsCancellationRequested && !runtime.IsCompleted && manager.InstanceIds.Count == 0, "End must cancel the pending driver and remove the instance.");
                Check(!manager.TryDequeueBackgroundError(out _), "Cancellation must not be reported as a background failure.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerRejectsDuplicatesAndDisposalCancelsPresenters()
        {
            var entered = NewCompletion<DialogueRequest>();
            var adapter = new RecordingAdapter { Dialogue = request => { entered.TrySetResult(request); return NewCompletion<bool>().Task; } };
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Pending")), End());
            var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(program, Minimal()).ToString()), id => adapter);
            await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "same" });
            await Within(entered.Task);
            var original = manager.GetRuntime("same");
            var duplicate = await ThrowsAsync(async () => { await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "same" }); });
            Check(duplicate.Code == "DUPLICATE_INSTANCE" && ReferenceEquals(original, manager.GetRuntime("same")), "Duplicate IDs must preserve the existing instance.");
            manager.Dispose();
            Check(adapter.LastToken.IsCancellationRequested, "Manager disposal must cancel the presenter token.");
            try { await manager.ControlAsync(new StoryControlRequest { Operation = "resume", InstanceId = "same" }); }
            catch (ObjectDisposedException) { return; }
            throw new InvalidOperationException("Disposed manager accepted new work.");
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerSessionPauseRestoreAndResumePreservesArguments()
        {
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Pending")), Instruction("i_add", "set-variable", "variableId", "v_score", "value", Binary("add", Ref("v_score", "number"), Literal(1))), End());
            Variables(program, Variable("v_score", "number", 0));
            var project = StoryProject.Parse(Envelope(program, Minimal()).ToString());
            var entered = NewCompletion<DialogueRequest>();
            var pendingAdapter = new RecordingAdapter { Dialogue = request => { entered.TrySetResult(request); return NewCompletion<bool>().Task; } };
            string saved;
            using (var manager = new StoryInstanceManager(project, id => pendingAdapter))
            {
                await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "saved", Arguments = new JObject { ["v_score"] = 4 } });
                await Within(entered.Task);
                await Within(manager.PauseAllAsync());
                saved = manager.ExportStateJson();
            }
            var adapter = new RecordingAdapter();
            using (var restored = new StoryInstanceManager(project, id => adapter))
            {
                restored.RestoreStateJson(saved);
                var result = await restored.ControlAsync(new StoryControlRequest { Operation = "resume", InstanceId = "saved", WaitForCompletion = true });
                Equal(result.Values["v_score"], new JValue(5));
                Check(restored.GetRuntime("saved").IsCompleted && adapter.Dialogues.Single().Text == "Pending", "Session resume lost its pending interaction.");
                var wrongVersion = JObject.Parse(saved); wrongVersion["projectContentVersion"] = "other";
                Check(Throws(() => restored.RestoreStateJson(wrongVersion.ToString())).Code == "PROGRAM_VERSION_MISMATCH", "Session content version mismatch must be rejected.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerBackgroundFailuresAreObservedAndInspectable()
        {
            var program = Minimal(Instruction("i_talk", "dialogue", "text", Text("t_talk", "Failure")), End());
            var adapter = new RecordingAdapter { Dialogue = request => throw new InvalidOperationException("presenter unavailable") };
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(program, Minimal()).ToString()), id => adapter))
            {
                await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "failed" });
                await Within(manager.ControlAsync(new StoryControlRequest { Operation = "end", InstanceId = "failed" }));
                Check(manager.TryDequeueBackgroundError(out var error) && error.Code == "ADAPTER_ERROR" && error.StoryId == "s_first", "Background adapter failures must remain visible to the host.");
                Check(!manager.TryDequeueBackgroundError(out _), "Failure should be observed once.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerRoutesNativeStoryControlAndReturnsChildVariables()
        {
            var parent = Minimal(
                Instruction("i_start", "start-story", "storyId", "s_second", "instanceId", Literal("child"), "arguments", new JObject { ["v_score"] = Literal(4) }, "resultVariableIds", new JObject { ["v_score"] = "v_score" }, "instanceVariableId", "v_instance", "waitForCompletion", true),
                Instruction("i_endchild", "end-story-instance", "instanceId", Ref("v_instance", "string"), "resultVariableIds", new JObject()), End());
            Variables(parent, Variable("v_score", "number", 0), Variable("v_instance", "string", ""));
            var child = Minimal(Instruction("i_add", "set-variable", "variableId", "v_score", "value", Binary("add", Ref("v_score", "number"), Literal(5))), End());
            Variables(child, Variable("v_score", "number", 0)); child["id"] = "p_child";
            var adapter = new RecordingAdapter { Control = request => throw new InvalidOperationException("Manager must route Story Control") };
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(parent, child).ToString()), id => adapter))
            {
                var result = await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "parent", WaitForCompletion = true });
                Equal(result.Values["v_score"], new JValue(9));
                Check(manager.InstanceIds.SequenceEqual(new[] { "parent" }) && manager.GetRuntime("parent").IsCompleted, "Child cleanup or parent completion differs.");
            }
        }

#if STORYBLUEPRINT_OFFLINE
        [Test]
#endif
        public async Task InstanceManagerRejectsSelfAwaitWithoutDeadlocking()
        {
            var program = Minimal(Instruction("i_self", "resume-story", "instanceId", Literal("self"), "resultVariableIds", new JObject(), "waitForCompletion", true), End());
            using (var manager = new StoryInstanceManager(StoryProject.Parse(Envelope(program, Minimal()).ToString()), id => new RecordingAdapter()))
            {
                var error = await ThrowsAsync(async () => { await manager.ControlAsync(new StoryControlRequest { Operation = "start", StoryId = "s_first", InstanceId = "self", WaitForCompletion = true }); });
                Check(error.Code == "INVALID_ADAPTER_RESULT", "A story awaiting itself must produce an explicit diagnostic.");
            }
        }

        [Test]
        public void InstanceManagerRejectsMalformedSessionEntriesWithStructuredErrors()
        {
            var project = StoryProject.Parse(Envelope(Minimal(), Minimal()).ToString());
            using (var manager = new StoryInstanceManager(project, id => new RecordingAdapter()))
            {
                foreach (var malformed in new JToken[] { JValue.CreateNull(), new JValue(42), new JObject { ["storyId"] = "s_first" } })
                {
                    var session = new JObject { ["format"] = "unity-story-session", ["version"] = 1, ["projectContentVersion"] = "test-1", ["instances"] = new JObject { ["bad"] = malformed } };
                    Check(Throws(() => manager.RestoreStateJson(session.ToString())).Code == "INVALID_STATE", "Malformed session entries must return a structured diagnostic.");
                    Check(manager.InstanceIds.Count == 0, "A failed session restore must be atomic.");
                }
            }
        }

        private static JObject Minimal(params JObject[] instructions)
        {
            return new JObject
            {
                ["format"] = "story-runtime", ["version"] = 7, ["id"] = "p_test", ["contentVersion"] = "test-1", ["entryBlockId"] = "b_entry",
                ["variables"] = new JArray(), ["chapters"] = new JObject(),
                ["blocks"] = new JObject { ["b_entry"] = Block("b_entry", instructions.Length == 0 ? new[] { End() } : instructions) }
            };
        }
        private static JObject Envelope(JObject first, JObject second)
        {
            return new JObject
            {
                ["format"] = "story-blueprint-compiled-project", ["version"] = 1, ["projectId"] = "proj_test", ["name"] = "test", ["displayName"] = "Test", ["contentVersion"] = "test-1", ["entryStoryId"] = "s_first", ["events"] = new JArray(), ["signals"] = new JArray(),
                ["stories"] = new JObject { ["s_first"] = new JObject { ["storyId"] = "s_first", ["name"] = "first", ["displayName"] = "First", ["program"] = first, ["characters"] = new JArray(), ["assets"] = new JArray() }, ["s_second"] = new JObject { ["storyId"] = "s_second", ["name"] = "second", ["displayName"] = "Second", ["program"] = second, ["characters"] = new JArray(), ["assets"] = new JArray() } }
            };
        }
        private static JObject ChoiceProgram()
        {
            var program = Minimal(Instruction("i_choice", "choice", "options", new JArray(
                new JObject { ["id"] = "opt_yes", ["text"] = Text("t_yes", "Yes"), ["target"] = "b_yes" },
                new JObject { ["id"] = "opt_disabled", ["text"] = Text("t_disabled", "Disabled"), ["target"] = "b_yes", ["enabledIf"] = Literal(false) })));
            ((JObject)program["blocks"])["b_yes"] = Block("b_yes", Instruction("i_talk", "dialogue", "text", Text("t_chosen", "Chosen")), End());
            return program;
        }
        private static JObject EventProgram()
        {
            var program = Minimal(Instruction("i_event", "call-event", "eventId", "ev_reward", "arguments", new JObject(), "outputs", new JArray(new JObject { ["id"] = "out_reward", ["name"] = "amount", ["valueType"] = Type("number") }), "resultVariableIds", new JObject { ["out_reward"] = "v_score" }), End());
            Variables(program, Variable("v_score", "number", 0)); return program;
        }
        private static JObject SignalProgram()
        {
            var program = Minimal(Instruction("i_signal", "wait-signal", "signalId", "sig_ready", "matches", new JObject { ["bossId"] = Literal("red_dragon") }), Instruction("i_set", "set-variable", "variableId", "v_score", "value", new JObject { ["kind"] = "signal-output", ["instructionId"] = "i_signal", ["outputId"] = "amount", ["valueType"] = Type("number") }), End());
            Variables(program, Variable("v_score", "number", 0)); return program;
        }
        private static JObject ChapterProgram()
        {
            var program = Minimal(Instruction("i_call", "call-chapter", "chapterId", "ch_test", "target", "b_chapter", "arguments", new JObject { ["v_param"] = Literal(4) }, "returnTo", new JObject { ["blockId"] = "b_after", ["instructionIndex"] = 0 }, "resultVariableIds", new JObject { ["v_result"] = "v_score" }));
            Variables(program, Variable("v_score", "number", 0));
            ((JObject)program["chapters"])["ch_test"] = new JObject { ["id"] = "ch_test", ["entryBlockId"] = "b_chapter", ["parameters"] = new JArray(new JObject { ["variableId"] = "v_param", ["valueType"] = Type("number"), ["defaultValue"] = 0 }), ["outputs"] = new JArray(new JObject { ["variableId"] = "v_result", ["valueType"] = Type("number") }), ["localVariables"] = new JArray(Variable("v_local", "number", 3, "chapter")) };
            ((JObject)program["blocks"])["b_chapter"] = Block("b_chapter", Instruction("i_inside", "dialogue", "text", Text("t_inside", "Inside")), Instruction("i_return", "return", "values", new JObject { ["v_result"] = Binary("multiply", Ref("v_param", "number"), Ref("v_local", "number")) }));
            ((JObject)program["blocks"])["b_after"] = Block("b_after", End()); return program;
        }
        private static JObject Instruction(string id, string op, params object[] fields)
        {
            var result = new JObject { ["id"] = id, ["op"] = op };
            for (var index = 0; index < fields.Length; index += 2) result[(string)fields[index]] = fields[index + 1] is JToken token ? token : JToken.FromObject(fields[index + 1]);
            return result;
        }
        private static JObject End() => Instruction("i_end", "end-story");
        private static JObject Block(string id, params JObject[] instructions) => new JObject { ["id"] = id, ["instructions"] = new JArray(instructions) };
        private static JObject Type(string kind) => new JObject { ["kind"] = kind };
        private static JObject Ref(string id, string kind) => new JObject { ["kind"] = "variable", ["variableId"] = id, ["valueType"] = Type(kind) };
        private static JObject Literal(object value) => new JObject { ["kind"] = "literal", ["value"] = JToken.FromObject(value), ["valueType"] = Type(value is bool ? "boolean" : value is string ? "string" : "number") };
        private static JObject Binary(string op, JObject left, JObject right) => new JObject { ["kind"] = "binary", ["operator"] = op, ["left"] = left, ["right"] = right, ["valueType"] = Type("number") };
        private static JObject Text(string id, string value) => new JObject { ["id"] = id, ["parts"] = new JArray(new JObject { ["kind"] = "text", ["value"] = value }) };
        private static JObject Variable(string id, string kind, object defaultValue, string scope = "story") => new JObject { ["id"] = id, ["name"] = id, ["displayName"] = id, ["scope"] = scope, ["valueType"] = Type(kind), ["defaultValue"] = JToken.FromObject(defaultValue) };
        private static void Variables(JObject program, params JObject[] variables) => program["variables"] = new JArray(variables);
        private static void Check(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        private static void Equal(JToken actual, JToken expected) => Check(SameValue(actual, expected), $"Expected {expected}, got {actual}.");
        // Blueprint has one finite Number type; JSON integer and floating representations are equivalent.
        private static bool SameValue(JToken actual, JToken expected)
        {
            if (actual == null || expected == null) return actual == expected;
            var actualNumber = actual.Type == JTokenType.Integer || actual.Type == JTokenType.Float;
            var expectedNumber = expected.Type == JTokenType.Integer || expected.Type == JTokenType.Float;
            if (actualNumber && expectedNumber) return actual.Value<double>() == expected.Value<double>();
            if (actual is JArray actualArray && expected is JArray expectedArray)
                return actualArray.Count == expectedArray.Count && actualArray.Zip(expectedArray, SameValue).All(equal => equal);
            if (actual is JObject actualObject && expected is JObject expectedObject)
                return actualObject.Count == expectedObject.Count && expectedObject.Properties().All(property => SameValue(actualObject[property.Name], property.Value));
            return JToken.DeepEquals(actual, expected);
        }
        private static StoryRuntimeException Throws(Action action)
        {
            try { action(); } catch (StoryRuntimeException error) { return error; }
            throw new InvalidOperationException("Expected a structured StoryRuntimeException.");
        }
        private static async Task<StoryRuntimeException> ThrowsAsync(Func<Task> action)
        {
            try { await Within(action()); } catch (StoryRuntimeException error) { return error; }
            throw new InvalidOperationException("Expected a structured StoryRuntimeException.");
        }
        private static TaskCompletionSource<T> NewCompletion<T>() => new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        private static async Task Within(Task task)
        {
            if (await Task.WhenAny(task, Task.Delay(TimeSpan.FromSeconds(5))) != task) throw new TimeoutException("Runtime did not settle within 5 seconds.");
            await task;
        }
        private static async Task Cancelled(Task task)
        {
            try { await Within(task); } catch (OperationCanceledException) { return; }
            throw new InvalidOperationException("Expected cancellation.");
        }
        private static string Fixture(string name)
        {
#if STORYBLUEPRINT_OFFLINE
            using (var stream = typeof(StoryRuntimeTests).Assembly.GetManifestResourceStream("Fixtures." + name))
            using (var reader = new StreamReader(stream ?? throw new FileNotFoundException(name))) return reader.ReadToEnd();
#else
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(StoryRuntimeTests).Assembly);
            return File.ReadAllText(Path.Combine(package.resolvedPath, "Tests", "Fixtures", name));
#endif
        }

        private sealed class RecordingAdapter : StoryAdapter
        {
            public readonly List<DialogueRequest> Dialogues = new List<DialogueRequest>();
            public readonly List<NarrationRequest> Narrations = new List<NarrationRequest>();
            public readonly List<ChoiceRequest> Choices = new List<ChoiceRequest>();
            public readonly List<EventRequest> Events = new List<EventRequest>();
            public readonly List<PlaybackMode> Modes = new List<PlaybackMode>();
            public int SignalCalls;
            public CancellationToken LastToken;
            public Func<DialogueRequest, Task> Dialogue = request => Task.CompletedTask;
            public Func<ChoiceRequest, Task<string>> Choice = request => Task.FromResult(request.Options.First(option => option.Enabled).Id);
            public Func<EventRequest, Task<JObject>> Event = request => Task.FromResult(new JObject { ["evo_success"] = true });
            public Func<SignalRequest, Task<JObject>> Signal = request => NewCompletion<JObject>().Task;
            public Func<JObject, Task<JToken>> Read = definition => Task.FromResult(definition["defaultValue"].DeepClone());
            public Func<JObject, JToken, Task> Write = (definition, value) => Task.CompletedTask;
            public Func<StoryControlRequest, Task<StoryControlResult>> Control = request => Task.FromResult(new StoryControlResult());
            public override Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken token) { LastToken = token; Dialogues.Add(request); Modes.Add(mode); return Dialogue(request); }
            public override Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken token) { Narrations.Add(request); return Task.CompletedTask; }
            public override Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken token) { Choices.Add(request); return Choice(request); }
            public override Task<JObject> CallEventAsync(EventRequest request, CancellationToken token) { Events.Add(request); return Event(request); }
            public override Task<JObject> WaitForSignalAsync(SignalRequest request, CancellationToken token) { SignalCalls++; return Signal(request); }
            public override Task<JToken> ReadExternalVariableAsync(JObject definition, CancellationToken token) => Read(definition);
            public override Task WriteExternalVariableAsync(JObject definition, JToken value, CancellationToken token) => Write(definition, value);
            public override Task<StoryControlResult> ControlStoryAsync(StoryControlRequest request, CancellationToken token) => Control(request);
        }
    }
}
