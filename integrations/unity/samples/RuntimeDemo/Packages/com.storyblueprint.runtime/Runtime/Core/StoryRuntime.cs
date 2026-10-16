using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StoryBlueprint.Runtime
{
    /// <summary>Native Blueprint executor. One driver at a time; cancellation preserves its current pause.</summary>
    public sealed class StoryRuntime
    {
        private readonly JObject program;
        private readonly IStoryAdapter adapter;
        private readonly Dictionary<string, JObject> definitions;
        private readonly object signalGate = new object();
        private JObject state;
        private int activeRun;
        private TaskCompletionSource<bool> signalChanged;
        public string StoryId { get; }
        public string Locale { get; set; }
        public string Status => (string)state["status"];
        public bool IsCompleted => Status == "completed";
        public StoryRuntimeException Diagnostic { get; private set; }
        public int MaxInstructionsPerInteraction { get; set; } = 10000;
        public IReadOnlyDictionary<string, JToken> Variables => ((JObject)state["storyVariables"])
            .Properties().ToDictionary(p => p.Name, p => p.Value.DeepClone());
        public JObject State { get { lock (signalGate) return (JObject)state.DeepClone(); } }

        public StoryRuntime(StoryProgram program, IStoryPresenter presenter, string storyId = null)
            : this(program, presenter as IStoryAdapter ?? new PresenterAdapter(presenter), storyId) { }

        public StoryRuntime(StoryProgram program, IStoryAdapter adapter, string storyId = null)
        {
            if (program == null) throw new ArgumentNullException(nameof(program));
            this.adapter = adapter ?? throw new ArgumentNullException(nameof(adapter));
            this.program = (JObject)program.Data.DeepClone();
            StoryId = storyId ?? program.Id;
            Locale = (string)this.program["sourceLocale"];
            definitions = ((JArray)this.program["variables"]).Cast<JObject>()
                .ToDictionary(v => (string)v["id"]);
            var variables = new JObject();
            foreach (var item in definitions) variables[item.Key] = item.Value["defaultValue"].DeepClone();
            state = new JObject {
                ["format"] = "unity-story-state", ["version"] = 1, ["storyId"] = StoryId,
                ["programId"] = program.Id, ["programContentVersion"] = program.ContentVersion,
                ["blockId"] = program.EntryBlockId, ["instructionIndex"] = 0,
                ["callStack"] = new JArray(), ["storyVariables"] = variables,
                ["signalInbox"] = new JObject(), ["eventOutputs"] = new JObject(),
                ["substoryOutputs"] = new JObject(), ["signalOutputs"] = new JObject(),
                ["pendingExternalWrites"] = new JObject(), ["externalHydrated"] = false, ["status"] = "running"
            };
        }

        public async Task RunAsync(PlaybackMode mode = PlaybackMode.Manual, CancellationToken cancellationToken = default)
        {
            if (Interlocked.CompareExchange(ref activeRun, 1, 0) != 0)
                throw Error("ALREADY_RUNNING", "This runtime already has an active driver");
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (Status == "failed") throw Diagnostic ?? Error("INVALID_STATE", "Restore a valid snapshot before restarting a failed runtime");
                if (!(bool)state["externalHydrated"])
                {
                    // Hydration is atomic: a failed read does not partially replace saved values.
                    var values = new JObject();
                    foreach (var item in definitions.Where(v => IsExternal(v.Value)))
                    {
                        var value = await Invoke(() => adapter.ReadExternalVariableAsync((JObject)item.Value.DeepClone(), cancellationToken), cancellationToken);
                        RequireType(value, item.Value, "INVALID_ADAPTER_RESULT", "External variable " + item.Key);
                        values[item.Key] = value.DeepClone();
                    }
                    foreach (var item in values.Properties()) ((JObject)state["storyVariables"])[item.Name] = item.Value.DeepClone();
                    state["externalHydrated"] = true;
                }
                var executed = 0;
                while (!IsCompleted)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (++executed > MaxInstructionsPerInteraction)
                        throw Error("TIGHT_LOOP", "Instruction budget exceeded without reaching an interaction");
                    var instruction = CurrentInstruction();
                    var op = (string)instruction["op"];
                    switch (op)
                    {
                        case "dialogue":
                        case "narration":
                        {
                            SetPending(op, instruction);
                            await FlushWrites(cancellationToken);
                            var text = (JObject)instruction["text"];
                            var rendered = await ResolveText(text, cancellationToken);
                            var voice = StoryEvaluator.ResolveVoice((JObject)instruction["voice"], Locale, program);
                            if (op == "dialogue")
                            {
                                var speaker = instruction["dynamicSpeaker"] == null ? (string)instruction["speakerId"]
                                    : (string)Evaluate(instruction["dynamicSpeaker"]);
                                var request = new DialogueRequest { RequestId = (string)instruction["id"], SpeakerId = speaker,
                                    TextId = (string)text["id"], Text = rendered, VoiceAssetId = voice,
                                    Emotion = (string)instruction["emotion"], PortraitId = (string)instruction["portraitId"],
                                    Tags = instruction["tags"]?.Values<string>().ToArray() ?? Array.Empty<string>() };
                                await Invoke(() => adapter.PresentDialogueAsync(request, mode, cancellationToken), cancellationToken);
                            }
                            else
                                await Invoke(() => adapter.PresentNarrationAsync(new NarrationRequest {
                                    RequestId = (string)instruction["id"], TextId = (string)text["id"], Text = rendered,
                                    VoiceAssetId = voice }, mode, cancellationToken), cancellationToken);
                            Advance(); executed = 0; break;
                        }
                        case "choice":
                        {
                            SetPending("choice", instruction);
                            await FlushWrites(cancellationToken);
                            var options = new List<ChoiceOption>();
                            foreach (var option in ((JArray)instruction["options"]).Cast<JObject>())
                            {
                                if (option["visibleIf"] != null && !Condition(option["visibleIf"])) continue;
                                options.Add(new ChoiceOption { Id = (string)option["id"], TextId = (string)option["text"]["id"],
                                    Text = await ResolveText((JObject)option["text"], cancellationToken),
                                    Enabled = option["enabledIf"] == null || Condition(option["enabledIf"]) });
                            }
                            if (!options.Any(o => o.Enabled)) throw Error("INVALID_OPTION", "Choice has no visible enabled options");
                            ((JObject)state["pending"])["optionIds"] = new JArray(options.Select(o => o.Id));
                            var prompt = (JObject)instruction["prompt"];
                            var request = new ChoiceRequest { RequestId = (string)instruction["id"], Options = options,
                                PromptTextId = (string)prompt?["id"], Prompt = prompt == null ? null : await ResolveText(prompt, cancellationToken) };
                            var selected = await Invoke(() => adapter.PresentChoiceAsync(request, cancellationToken), cancellationToken);
                            if (!options.Any(o => o.Id == selected && o.Enabled))
                                throw Error("INVALID_OPTION", "Choice option is missing, hidden or disabled: " + selected);
                            Jump((string)((JArray)instruction["options"]).First(o => (string)o["id"] == selected)["target"]);
                            executed = 0; break;
                        }
                        case "branch":
                        {
                            var value = Evaluate(instruction["condition"]);
                            if (value.Type != JTokenType.Boolean) throw Error("EXPRESSION_ERROR", "Branch condition must be boolean");
                            Jump((string)instruction[(bool)value ? "whenTrue" : "whenFalse"]); break;
                        }
                        case "jump": Jump((string)instruction["target"]); break;
                        case "set-variable": Assign(instruction); Advance(); break;
                        case "call-event":
                        {
                            SetPending("event", instruction);
                            await FlushWrites(cancellationToken);
                            var result = await Invoke(() => adapter.CallEventAsync(new EventRequest {
                                RequestId = (string)instruction["id"], EventId = (string)instruction["eventId"],
                                Arguments = EvaluateMap((JObject)instruction["arguments"]),
                                Outputs = (JArray)instruction["outputs"].DeepClone() }, cancellationToken), cancellationToken);
                            if (result == null) throw Error("INVALID_ADAPTER_RESULT", "Event result must be an object");
                            foreach (var output in ((JArray)instruction["outputs"]).Cast<JObject>())
                            {
                                var id = (string)output["id"];
                                if (result.Property(id) == null) throw Error("INVALID_ADAPTER_RESULT", "Missing Event output ID " + id);
                                RequireType(result[id], output, "INVALID_ADAPTER_RESULT", "Event output " + id);
                            }
                            ValidateMappings((JObject)instruction["resultVariableIds"], result, "INVALID_ADAPTER_RESULT");
                            var declared = new JObject();
                            foreach (var output in (JArray)instruction["outputs"]) declared[(string)output["id"]] = result[(string)output["id"]].DeepClone();
                            ((JObject)state["eventOutputs"])[(string)instruction["id"]] = declared;
                            ApplyMappings((JObject)instruction["resultVariableIds"], result);
                            Advance(); executed = 0; break;
                        }
                        case "wait-signal":
                        {
                            // Preserve evaluated match constraints across cancellation/save/restore.
                            var previous = (JObject)state["pending"];
                            var matches = (string)previous?["kind"] == "signal" ? (JObject)previous["matches"]
                                : EvaluateMap((JObject)instruction["matches"]);
                            var signalId = (string)instruction["signalId"];
                            var payload = ConsumeSignal(signalId, matches);
                            if (payload == null)
                            {
                                SetPending("signal", instruction);
                                state["pending"]["matches"] = matches.DeepClone(); state["pending"]["signalId"] = signalId;
                                await FlushWrites(cancellationToken);
                                payload = await WaitSignal(new SignalRequest { RequestId = (string)instruction["id"],
                                    SignalId = signalId, Matches = (JObject)matches.DeepClone() }, cancellationToken);
                                executed = 0;
                            }
                            ((JObject)state["signalOutputs"])[(string)instruction["id"]] = payload.DeepClone();
                            Advance(); break;
                        }
                        case "call-chapter": CallChapter(instruction); break;
                        case "return": Return(instruction); break;
                        case "start-story":
                        case "switch-story":
                        case "resume-story":
                        case "end-story-instance":
                        {
                            SetPending("story-control", instruction);
                            await FlushWrites(cancellationToken);
                            var instance = instruction["instanceId"] == null ? null : Evaluate(instruction["instanceId"]);
                            if (instance != null && instance.Type != JTokenType.String)
                                throw Error("EXPRESSION_ERROR", "Story instance ID must be a string");
                            var action = op == "start-story" ? "start" : op == "switch-story" ? "switch" : op == "resume-story" ? "resume" : "end";
                            state["pending"]["action"] = action;
                            var result = await Invoke(() => adapter.ControlStoryAsync(new StoryControlRequest {
                                RequestId = (string)instruction["id"], Operation = action, StoryId = (string)instruction["storyId"],
                                InstanceId = (string)instance, Arguments = EvaluateMap((JObject)instruction["arguments"]),
                                WaitForCompletion = (bool?)instruction["waitForCompletion"] ?? false }, cancellationToken), cancellationToken);
                            if (result == null) throw Error("INVALID_ADAPTER_RESULT", "Story Control returned no result");
                            var values = result.Values ?? new JObject();
                            ValidateMappings((JObject)instruction["resultVariableIds"], values, "INVALID_ADAPTER_RESULT");
                            var instanceVariable = (string)instruction["instanceVariableId"];
                            if (instanceVariable != null && result.InstanceId != null)
                            {
                                var type = VariableDefinition(instanceVariable);
                                if ((string)type["valueType"]["kind"] != "string")
                                    throw Error("INVALID_ADAPTER_RESULT", "Instance variable must be a String");
                                WriteVariable(instanceVariable, new JValue(result.InstanceId));
                            }
                            ApplyMappings((JObject)instruction["resultVariableIds"], values);
                            Advance(); executed = 0; break;
                        }
                        case "end-story": state.Remove("pending"); state["status"] = "completed"; break;
                        default: throw Error("UNSUPPORTED_INSTRUCTION", "Unsupported instruction " + op);
                    }
                }
                await FlushWrites(cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (StoryRuntimeException error)
            {
                Diagnostic = error.StoryId == null ? Error(error.Code, error.Message, error) : error;
                state["status"] = "failed"; state["failureCode"] = Diagnostic.Code; throw Diagnostic;
            }
            catch (Exception error)
            {
                Diagnostic = Error("EXPRESSION_ERROR", error.Message, error); state["status"] = "failed"; state["failureCode"] = Diagnostic.Code; throw Diagnostic;
            }
            finally { Interlocked.Exchange(ref activeRun, 0); }
        }

        /// <summary>Buffer early signals, or wake an active wait. Safe to call from a game callback thread.</summary>
        public void SendSignal(string signalId, JObject payload = null)
        {
            if (string.IsNullOrEmpty(signalId)) throw new ArgumentException("Signal ID is required", nameof(signalId));
            lock (signalGate)
            {
                var inbox = (JObject)state["signalInbox"];
                var queue = inbox[signalId] as JArray;
                if (queue == null) inbox[signalId] = queue = new JArray();
                queue.Add((payload ?? new JObject()).DeepClone());
                signalChanged?.TrySetResult(true);
            }
        }

        public string ExportStateJson()
        {
            lock (signalGate)
            {
                var snapshot = (JObject)state.DeepClone(); snapshot["locale"] = Locale;
                return snapshot.ToString(Formatting.None);
            }
        }

        /// <summary>Restore only after cancelling and awaiting the previous RunAsync call.</summary>
        public void RestoreStateJson(string json)
        {
            if (Volatile.Read(ref activeRun) != 0) throw Error("ALREADY_RUNNING", "Cancel and await the driver before restoring state");
            JObject restored;
            try { restored = StoryProgram.ReadObject(json); }
            catch (Exception error) { throw Error("INVALID_STATE", "State must be a JSON object", error); }
            if (restored["format"]?.Type != JTokenType.String || (string)restored["format"] != "unity-story-state" ||
                restored["version"]?.Type != JTokenType.Integer || (double?)restored["version"] != 1)
                throw Error("STATE_VERSION_MISMATCH", "Unsupported Unity story state format or version");
            foreach (var field in new[] { "storyId", "programId", "programContentVersion" })
                if (restored[field]?.Type != JTokenType.String) throw Error("INVALID_STATE", "Saved identity must be a string: " + field);
            if ((string)restored["storyId"] != StoryId || (string)restored["programId"] != (string)program["id"] ||
                (string)restored["programContentVersion"] != (string)program["contentVersion"])
                throw Error("PROGRAM_VERSION_MISMATCH", "Save does not match this Story ID, Program ID and content version");
            try { ValidateState(restored); }
            catch (StoryRuntimeException) { throw; }
            catch (Exception error) { throw Error("INVALID_STATE", "Malformed saved state: " + error.Message, error); }
            lock (signalGate) state = (JObject)restored.DeepClone();
            Locale = (string)restored["locale"] ?? (string)program["sourceLocale"]; Diagnostic = null;
        }

        public async Task RetryExternalWritesAsync(CancellationToken cancellationToken = default)
        {
            if (Interlocked.CompareExchange(ref activeRun, 1, 0) != 0)
                throw Error("ALREADY_RUNNING", "The runtime driver is active");
            try
            {
                var hadWrites = ((JObject)state["pendingExternalWrites"]).HasValues;
                await FlushWrites(cancellationToken);
                if (hadWrites && Status == "failed" && (Diagnostic?.Code ?? (string)state["failureCode"]) == "ADAPTER_ERROR")
                {
                    state["status"] = (string)CurrentInstruction()["op"] == "end-story" ? "completed" : state["pending"] != null ? "waiting" : "running";
                    Diagnostic = null;
                    state.Remove("failureCode");
                }
            }
            finally { Interlocked.Exchange(ref activeRun, 0); }
        }

        /// <summary>Set initial host arguments before the first execution; keys are variable IDs or names.</summary>
        public void InitializeArguments(JObject arguments)
        {
            if (Volatile.Read(ref activeRun) != 0 || (bool)state["externalHydrated"])
                throw Error("INVALID_STATE", "Arguments must be supplied before first execution");
            var updates = new Dictionary<string, JToken>();
            foreach (var argument in (arguments ?? new JObject()).Properties())
            {
                var definition = definitions.TryGetValue(argument.Name, out var byId) ? byId
                    : definitions.Values.FirstOrDefault(v => (string)v["name"] == argument.Name);
                if (definition == null || IsExternal(definition)) throw Error("INVALID_ADAPTER_RESULT", "Unknown story argument " + argument.Name);
                RequireType(argument.Value, definition, "INVALID_ADAPTER_RESULT", "Story argument " + argument.Name);
                updates[(string)definition["id"]] = argument.Value.DeepClone();
            }
            foreach (var update in updates) ((JObject)state["storyVariables"])[update.Key] = update.Value;
        }

        private async Task FlushWrites(CancellationToken token)
        {
            var writes = (JObject)state["pendingExternalWrites"];
            foreach (var item in writes.Properties().ToArray())
            {
                var definition = definitions[item.Name];
                await Invoke(() => adapter.WriteExternalVariableAsync((JObject)definition.DeepClone(), item.Value.DeepClone(), token), token);
                writes.Remove(item.Name);
            }
        }

        private async Task<string> ResolveText(JObject text, CancellationToken token)
        {
            var overrideText = await Invoke(() => adapter.ResolveTextAsync((string)text["id"], Locale, token), token);
            return overrideText ?? StoryEvaluator.Render(text, Locale, program, ReadVariable, ReadOutput);
        }

        private async Task<JObject> WaitSignal(SignalRequest request, CancellationToken token)
        {
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                try
                {
                    Task<JObject> host = null;
                    while (true)
                    {
                        Task changed;
                        lock (signalGate)
                        {
                            var payload = ConsumeSignal(request.SignalId, request.Matches);
                            if (payload != null) return payload;
                            signalChanged = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                            changed = signalChanged.Task;
                        }
                        if (host == null)
                        {
                            host = Invoke(() => adapter.WaitForSignalAsync(request, linked.Token), linked.Token);
                            _ = host.ContinueWith(t => { var ignored = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                        }
                        var winner = await AwaitCancelled(Task.WhenAny(changed, host), token);
                        if (winner == host)
                        {
                            var payload = await host;
                            if (payload == null || !PayloadMatches(payload, request.Matches))
                                throw Error("INVALID_ADAPTER_RESULT", "Signal payload does not match the pending constraints");
                            return (JObject)payload.DeepClone();
                        }
                    }
                }
                finally
                {
                    linked.Cancel();
                    lock (signalGate) signalChanged = null;
                }
            }
        }

        private JObject ConsumeSignal(string id, JObject matches)
        {
            lock (signalGate)
            {
                var inbox = (JObject)state["signalInbox"];
                if (!(inbox[id] is JArray queue)) return null;
                for (var i = 0; i < queue.Count; i++)
                {
                    var payload = (JObject)queue[i];
                    if (!PayloadMatches(payload, matches)) continue;
                    var result = (JObject)payload.DeepClone(); queue.RemoveAt(i);
                    if (queue.Count == 0) inbox.Remove(id);
                    return result;
                }
                return null;
            }
        }
        private static bool PayloadMatches(JObject payload, JObject matches) => matches.Properties()
            .All(p => payload.Property(p.Name) != null && StoryEvaluator.DeepEquals(payload[p.Name], p.Value));

        private JToken Evaluate(JToken expression) => StoryEvaluator.Evaluate((JObject)expression, ReadVariable, ReadOutput);
        private bool Condition(JToken expression)
        {
            var value = Evaluate(expression);
            if (value.Type != JTokenType.Boolean) throw Error("EXPRESSION_ERROR", "Choice condition must be boolean");
            return (bool)value;
        }
        private JObject EvaluateMap(JObject expressions)
        {
            var result = new JObject();
            if (expressions != null) foreach (var p in expressions.Properties()) result[p.Name] = Evaluate(p.Value).DeepClone();
            return result;
        }
        private JObject TopFrame => ((JArray)state["callStack"]).Last as JObject;
        private JToken ReadVariable(string id)
        {
            var locals = (JObject)TopFrame?["locals"];
            if (locals?.Property(id) != null) return locals[id];
            var variables = (JObject)state["storyVariables"];
            if (variables.Property(id) == null) throw Error("EXPRESSION_ERROR", "Missing variable " + id);
            return variables[id];
        }
        private JToken ReadOutput(string kind, string instructionId, string outputId)
        {
            var category = kind == "event-output" ? "eventOutputs" : kind == "substory-output" ? "substoryOutputs" : "signalOutputs";
            var outputs = state[category][instructionId] as JObject;
            if (outputs?.Property(outputId) == null) throw Error("EXPRESSION_ERROR", "Output is unavailable: " + instructionId + "/" + outputId);
            return outputs[outputId];
        }
        private JObject VariableDefinition(string id, JObject frame = null)
        {
            return VariableDefinitionInFrame(id, frame ?? TopFrame);
        }
        private JObject VariableDefinitionInFrame(string id, JObject frame)
        {
            if (((JObject)frame?["locals"])?.Property(id) != null)
            {
                var chapter = (JObject)program["chapters"][(string)frame["chapterId"]];
                return ((JArray)chapter["parameters"]).Concat((JArray)chapter["localVariables"]).Cast<JObject>()
                    .First(v => (string)(v["variableId"] ?? v["id"]) == id);
            }
            if (!definitions.TryGetValue(id, out var result)) throw Error("EXPRESSION_ERROR", "Unknown variable " + id);
            return result;
        }
        private void RequireType(JToken value, JObject definition, string code, string label)
        {
            if (value == null || !StoryEvaluator.MatchesType(value, (JObject)definition["valueType"]))
                throw Error(code, label + " does not match " + (string)definition["valueType"]["kind"]);
        }
        private void WriteVariable(string id, JToken value)
        {
            var definition = VariableDefinition(id);
            RequireType(value, definition, "EXPRESSION_ERROR", "Variable " + id);
            var locals = (JObject)TopFrame?["locals"];
            if (locals?.Property(id) != null) { locals[id] = value.DeepClone(); return; }
            ((JObject)state["storyVariables"])[id] = value.DeepClone();
            if (IsExternal(definition)) ((JObject)state["pendingExternalWrites"])[id] = value.DeepClone();
        }
        private static bool IsExternal(JObject variable) => (string)variable["scope"] == "project" || (string)variable["scope"] == "character";
        private void Assign(JObject instruction)
        {
            var id = (string)instruction["variableId"];
            var value = Evaluate(instruction["value"]);
            var operation = (string)instruction["containerOperation"];
            if (operation == null) { WriteVariable(id, value); return; }
            var current = ReadVariable(id).DeepClone();
            switch (operation)
            {
                case "append":
                    if (!(current is JArray array)) throw Error("EXPRESSION_ERROR", "Append requires an Array");
                    array.Add(value.DeepClone()); break;
                case "set-entry":
                    if (!(current is JObject map)) throw Error("EXPRESSION_ERROR", "Set entry requires a Map");
                    var key = Evaluate(instruction["key"]);
                    if (key.Type != JTokenType.String && key.Type != JTokenType.Integer && key.Type != JTokenType.Float)
                        throw Error("EXPRESSION_ERROR", "Map key must be a String or Number");
                    map[StoryEvaluator.FormatValue(key)] = value.DeepClone(); break;
                case "set-field":
                    if (!(current is JObject record)) throw Error("EXPRESSION_ERROR", "Set field requires an Object");
                    record[(string)instruction["fieldName"]] = value.DeepClone(); break;
                default: throw Error("UNSUPPORTED_INSTRUCTION", "Unknown container operation " + operation);
            }
            WriteVariable(id, current);
        }
        private void ValidateMappings(JObject mappings, JObject values, string code)
        {
            if (mappings == null) return;
            foreach (var map in mappings.Properties()) if (values.Property(map.Name) != null)
                RequireType(values[map.Name], VariableDefinition((string)map.Value), code, "Result " + map.Name);
        }
        private void ApplyMappings(JObject mappings, JObject values)
        {
            if (mappings == null) return;
            foreach (var map in mappings.Properties()) if (values.Property(map.Name) != null) WriteVariable((string)map.Value, values[map.Name]);
        }
        private void CallChapter(JObject instruction)
        {
            var chapter = (JObject)program["chapters"][(string)instruction["chapterId"]];
            var locals = new JObject();
            foreach (var variable in ((JArray)chapter["parameters"]).Concat((JArray)chapter["localVariables"]).Cast<JObject>())
                locals[(string)(variable["variableId"] ?? variable["id"])] = variable["defaultValue"].DeepClone();
            var arguments = EvaluateMap((JObject)instruction["arguments"]);
            foreach (var argument in arguments.Properties())
            {
                var definition = ((JArray)chapter["parameters"]).Cast<JObject>().First(v => (string)v["variableId"] == argument.Name);
                RequireType(argument.Value, definition, "EXPRESSION_ERROR", "Chapter argument " + argument.Name);
                locals[argument.Name] = argument.Value.DeepClone();
            }
            ((JArray)state["callStack"]).Add(new JObject { ["chapterId"] = (string)instruction["chapterId"],
                ["callInstructionId"] = (string)instruction["id"], ["returnTo"] = instruction["returnTo"].DeepClone(),
                ["resultVariableIds"] = instruction["resultVariableIds"].DeepClone(), ["locals"] = locals });
            Jump((string)instruction["target"]);
        }
        private void Return(JObject instruction)
        {
            var frame = TopFrame;
            if (frame == null) throw Error("INVALID_LOCATION", "Return requires a calling chapter frame");
            var chapter = (JObject)program["chapters"][(string)frame["chapterId"]];
            var values = EvaluateMap((JObject)instruction["values"]);
            foreach (var value in values.Properties())
            {
                var definition = ((JArray)chapter["outputs"]).Cast<JObject>().FirstOrDefault(o => (string)o["variableId"] == value.Name);
                if (definition == null) throw Error("EXPRESSION_ERROR", "Unknown chapter output " + value.Name);
                RequireType(value.Value, definition, "EXPRESSION_ERROR", "Chapter output " + value.Name);
            }
            var stack = (JArray)state["callStack"];
            var callerFrame = stack.Count > 1 ? (JObject)stack[stack.Count - 2] : null;
            foreach (var mapping in ((JObject)frame["resultVariableIds"]).Properties())
                if (values.Property(mapping.Name) != null)
                    RequireType(values[mapping.Name], VariableDefinitionInFrame((string)mapping.Value, callerFrame), "EXPRESSION_ERROR", "Chapter result " + mapping.Name);
            stack.RemoveAt(stack.Count - 1);
            ((JObject)state["substoryOutputs"])[(string)frame["callInstructionId"]] = values.DeepClone();
            ApplyMappings((JObject)frame["resultVariableIds"], values);
            state["blockId"] = (string)frame["returnTo"]["blockId"];
            state["instructionIndex"] = (int)frame["returnTo"]["instructionIndex"];
            state.Remove("pending"); state["status"] = "running";
        }
        private JObject CurrentInstruction() => InstructionAt(state);
        private JObject InstructionAt(JObject snapshot)
        {
            var instructions = program["blocks"][(string)snapshot["blockId"]]?["instructions"] as JArray;
            var index = (int?)snapshot["instructionIndex"];
            if (instructions == null || index == null || index < 0 || index >= instructions.Count)
                throw Error("INVALID_LOCATION", "No instruction at saved execution location");
            return (JObject)instructions[index.Value];
        }
        private void SetPending(string kind, JObject instruction)
        {
            state["pending"] = new JObject { ["kind"] = kind, ["requestId"] = (string)instruction["id"], ["instructionId"] = (string)instruction["id"] };
            state["status"] = "waiting";
        }
        private void Advance() { state["instructionIndex"] = (int)state["instructionIndex"] + 1; state.Remove("pending"); state["status"] = "running"; }
        private void Jump(string blockId) { state["blockId"] = blockId; state["instructionIndex"] = 0; state.Remove("pending"); state["status"] = "running"; }

        private void ValidateState(JObject snapshot)
        {
            var status = (string)snapshot["status"];
            if (status != "running" && status != "waiting" && status != "completed" && status != "failed")
                throw Error("INVALID_STATE", "Invalid saved runtime status");
            foreach (var name in new[] { "storyVariables", "signalInbox", "eventOutputs", "substoryOutputs", "signalOutputs", "pendingExternalWrites" })
                if (!(snapshot[name] is JObject)) throw Error("INVALID_STATE", "Missing saved object " + name);
            if (!(snapshot["callStack"] is JArray stack) || snapshot["externalHydrated"]?.Type != JTokenType.Boolean)
                throw Error("INVALID_STATE", "Missing call stack or hydration flag");
            if (snapshot["instructionIndex"]?.Type != JTokenType.Integer || snapshot["blockId"]?.Type != JTokenType.String)
                throw Error("INVALID_STATE", "Invalid execution location");
            var current = InstructionAt(snapshot);
            foreach (var definition in definitions)
                RequireType(snapshot["storyVariables"][definition.Key], definition.Value, "INVALID_STATE", "Saved variable " + definition.Key);
            foreach (var variable in ((JObject)snapshot["storyVariables"]).Properties())
                if (!definitions.ContainsKey(variable.Name)) throw Error("INVALID_STATE", "Unknown saved variable " + variable.Name);
            foreach (var write in ((JObject)snapshot["pendingExternalWrites"]).Properties())
            {
                if (!definitions.TryGetValue(write.Name, out var definition) || !IsExternal(definition))
                    throw Error("INVALID_STATE", "Invalid external write " + write.Name);
                RequireType(write.Value, definition, "INVALID_STATE", "Saved write " + write.Name);
                if (!StoryEvaluator.DeepEquals(write.Value, snapshot["storyVariables"][write.Name]))
                    throw Error("INVALID_STATE", "Queued external write does not match the saved variable " + write.Name);
            }
            foreach (var frame in stack.Cast<JObject>())
            {
                var call = FindInstruction((string)frame["callInstructionId"]);
                if (call == null || (string)call["op"] != "call-chapter" || !JToken.DeepEquals(call["chapterId"], frame["chapterId"]) ||
                    !JToken.DeepEquals(call["returnTo"], frame["returnTo"]) || !JToken.DeepEquals(call["resultVariableIds"], frame["resultVariableIds"]))
                    throw Error("INVALID_STATE", "Invalid chapter frame");
                var chapter = (JObject)program["chapters"][(string)frame["chapterId"]];
                if (!(frame["locals"] is JObject locals)) throw Error("INVALID_STATE", "Missing saved chapter locals");
                foreach (var definition in ((JArray)chapter["parameters"]).Concat((JArray)chapter["localVariables"]).Cast<JObject>())
                    RequireType(locals[(string)(definition["variableId"] ?? definition["id"])], definition, "INVALID_STATE", "Saved chapter local");
            }
            foreach (var category in new[] { "eventOutputs", "substoryOutputs", "signalOutputs" })
            {
                foreach (var entry in ((JObject)snapshot[category]).Properties())
                {
                    var instruction = FindInstruction(entry.Name);
                    var expectedOp = category == "eventOutputs" ? "call-event" : category == "substoryOutputs" ? "call-chapter" : "wait-signal";
                    if (instruction == null || (string)instruction["op"] != expectedOp || !(entry.Value is JObject outputs))
                        throw Error("INVALID_STATE", "Invalid saved outputs for " + entry.Name);
                    if (category == "signalOutputs") continue;
                    var outputDefinitions = category == "eventOutputs" ? (JArray)instruction["outputs"]
                        : (JArray)program["chapters"][(string)instruction["chapterId"]]["outputs"];
                    if (category == "eventOutputs" && outputDefinitions.Any(o => outputs.Property((string)o["id"]) == null))
                        throw Error("INVALID_STATE", "Saved Event result is missing a required output");
                    foreach (var output in outputs.Properties())
                    {
                        var definition = outputDefinitions.Cast<JObject>().FirstOrDefault(o => (string)(o["id"] ?? o["variableId"]) == output.Name);
                        if (definition == null) throw Error("INVALID_STATE", "Unknown saved output " + output.Name);
                        RequireType(output.Value, definition, "INVALID_STATE", "Saved output " + output.Name);
                    }
                }
            }
            foreach (var inbox in ((JObject)snapshot["signalInbox"]).Properties())
                if (!(inbox.Value is JArray payloads) || payloads.Any(p => !(p is JObject)))
                    throw Error("INVALID_STATE", "Invalid signal inbox");
            var pending = snapshot["pending"] as JObject;
            if (snapshot["locale"] != null && snapshot["locale"].Type != JTokenType.Null && snapshot["locale"].Type != JTokenType.String)
                throw Error("INVALID_STATE", "Saved locale must be a string");
            if ((status == "waiting") != (pending != null) && status != "failed")
                throw Error("INVALID_STATE", "Pending interaction and status disagree");
            if (status == "completed" && (string)current["op"] != "end-story") throw Error("INVALID_STATE", "Completed save must point to End Story");
            if (pending != null)
            {
                var op = (string)current["op"];
                var expected = op == "call-event" ? "event" : op == "wait-signal" ? "signal" :
                    new[] { "start-story", "switch-story", "resume-story", "end-story-instance" }.Contains(op) ? "story-control" : op;
                if (!new[] { "dialogue", "narration", "choice", "event", "signal", "story-control" }.Contains(expected) ||
                    (string)pending["kind"] != expected || (string)pending["instructionId"] != (string)current["id"] ||
                    (string)pending["requestId"] != (string)current["id"])
                    throw Error("INVALID_STATE", "Pending interaction does not match the saved instruction");
                if (expected == "signal" && (!(pending["matches"] is JObject) || (string)pending["signalId"] != (string)current["signalId"]))
                    throw Error("INVALID_STATE", "Malformed pending Signal");
                if (expected == "signal")
                {
                    var constraints = (JObject)current["matches"];
                    var matches = (JObject)pending["matches"];
                    if (constraints.Count != matches.Count) throw Error("INVALID_STATE", "Saved Signal constraints differ from the instruction");
                    foreach (var constraint in constraints.Properties())
                        RequireType(matches[constraint.Name], (JObject)constraint.Value, "INVALID_STATE", "Saved Signal constraint " + constraint.Name);
                }
            }
        }
        private JObject FindInstruction(string id) => ((JObject)program["blocks"]).Properties()
            .SelectMany(p => ((JArray)p.Value["instructions"]).Cast<JObject>()).FirstOrDefault(i => (string)i["id"] == id);
        private StoryRuntimeException Error(string code, string message, Exception cause = null)
        {
            var block = (string)state?["blockId"]; var index = (int?)state?["instructionIndex"] ?? 0;
            var instructions = block == null ? null : program["blocks"][block]?["instructions"] as JArray;
            var id = instructions != null && index >= 0 && index < instructions.Count ? (string)instructions[index]["id"] : null;
            return new StoryRuntimeException(code, message, "$.blocks." + block + ".instructions[" + index + "]", StoryId, block, id, cause);
        }
        private async Task Invoke(Func<Task> action, CancellationToken token)
        {
            try { token.ThrowIfCancellationRequested(); await AwaitCancelled(action(), token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (StoryRuntimeException) { throw; }
            catch (Exception error) { throw Error("ADAPTER_ERROR", error.Message, error); }
        }
        private async Task<T> Invoke<T>(Func<Task<T>> action, CancellationToken token)
        {
            try { token.ThrowIfCancellationRequested(); return await AwaitCancelled(action(), token); }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (StoryRuntimeException) { throw; }
            catch (Exception error) { throw Error("ADAPTER_ERROR", error.Message, error); }
        }
        private static async Task AwaitCancelled(Task task, CancellationToken token)
        {
            if (task == null) throw new InvalidOperationException("Adapter returned no task");
            var cancelled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (token.Register(() => cancelled.TrySetCanceled()))
            {
                if (await Task.WhenAny(task, cancelled.Task) != task)
                {
                    _ = task.ContinueWith(t => { var ignored = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                    token.ThrowIfCancellationRequested();
                }
                token.ThrowIfCancellationRequested(); await task; token.ThrowIfCancellationRequested();
            }
        }
        private static async Task<T> AwaitCancelled<T>(Task<T> task, CancellationToken token)
        {
            await AwaitCancelled((Task)task, token); return await task;
        }
        private sealed class PresenterAdapter : StoryAdapter
        {
            private readonly IStoryPresenter presenter;
            public PresenterAdapter(IStoryPresenter presenter) { this.presenter = presenter ?? throw new ArgumentNullException(nameof(presenter)); }
            public override Task PresentDialogueAsync(DialogueRequest r, PlaybackMode m, CancellationToken c) => presenter.PresentDialogueAsync(r, m, c);
            public override Task PresentNarrationAsync(NarrationRequest r, PlaybackMode m, CancellationToken c) => presenter.PresentNarrationAsync(r, m, c);
            public override Task<string> PresentChoiceAsync(ChoiceRequest r, CancellationToken c) => presenter.PresentChoiceAsync(r, c);
        }
    }
}
