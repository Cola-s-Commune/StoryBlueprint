using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StoryBlueprint.Runtime
{
    /// <summary>Owns independent runtime instances and observes background failures. Use from one host thread.</summary>
    public sealed class StoryInstanceManager : IDisposable
    {
        private sealed class Instance
        {
            public string Id;
            public string StoryId;
            public StoryRuntime Runtime;
            public CancellationTokenSource Cancellation;
            public Task Execution;
            public string WaitingFor;
        }
        private readonly StoryProject project;
        private readonly Func<string, IStoryAdapter> adapterFactory;
        private readonly Dictionary<string, Instance> instances = new Dictionary<string, Instance>();
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly Queue<StoryRuntimeException> backgroundErrors = new Queue<StoryRuntimeException>();
        private bool disposed;
        public PlaybackMode PlaybackMode { get; set; } = PlaybackMode.Manual;
        /// <summary>Optional engine hook for scene/focus transitions; "switch" starts its target without cancelling the caller.</summary>
        public Func<StoryControlRequest, CancellationToken, Task> TransitionHandler { get; set; }
        public IReadOnlyList<string> InstanceIds => instances.Keys.ToArray();

        public StoryInstanceManager(StoryProject project, Func<string, IStoryAdapter> adapterFactory)
        {
            this.project = project ?? throw new ArgumentNullException(nameof(project));
            this.adapterFactory = adapterFactory ?? throw new ArgumentNullException(nameof(adapterFactory));
        }

        public StoryRuntime GetRuntime(string instanceId) => Find(instanceId).Runtime;

        public bool TryDequeueBackgroundError(out StoryRuntimeException error)
        {
            lock (backgroundErrors)
            {
                if (backgroundErrors.Count == 0) { error = null; return false; }
                error = backgroundErrors.Dequeue(); return true;
            }
        }

        /// <summary>Nonwaiting runs use the manager lifetime; dispose/end cancels them explicitly.</summary>
        public Task<StoryControlResult> ControlAsync(StoryControlRequest request, CancellationToken cancellationToken = default)
            => ControlAsync(request, null, cancellationToken);

        private async Task<StoryControlResult> ControlAsync(StoryControlRequest request, string ownerId, CancellationToken token)
        {
            if (disposed) throw new ObjectDisposedException(nameof(StoryInstanceManager));
            token.ThrowIfCancellationRequested();
            if (request == null) throw new ArgumentNullException(nameof(request));
            if (request.Operation == "end")
            {
                if (request.InstanceId == ownerId) throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "A running story cannot end itself through its own awaited callback");
                var ended = Find(request.InstanceId);
                if (TransitionHandler != null) await TransitionHandler(request, token);
                token.ThrowIfCancellationRequested();
                await StopInstance(ended);
                instances.Remove(ended.Id);
                return Result(ended);
            }
            Instance instance;
            if (request.Operation == "resume")
            {
                instance = Find(request.InstanceId);
                if (instance.Id == ownerId && request.WaitForCompletion)
                    throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "A story cannot wait for its own completion");
                if (TransitionHandler != null) await TransitionHandler(request, token);
                token.ThrowIfCancellationRequested();
            }
            else if (request.Operation == "start" || request.Operation == "switch")
            {
                if (!project.Programs.TryGetValue(request.StoryId ?? "", out var program))
                    throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "Unknown Story ID " + request.StoryId);
                var id = string.IsNullOrEmpty(request.InstanceId) ? Guid.NewGuid().ToString("N") : request.InstanceId;
                if (instances.ContainsKey(id)) throw new StoryRuntimeException("DUPLICATE_INSTANCE", "Story instance already exists: " + id);
                instance = Create(id, request.StoryId, program);
                instance.Runtime.InitializeArguments(request.Arguments);
                if (TransitionHandler != null) await TransitionHandler(request, token);
                token.ThrowIfCancellationRequested();
                instances.Add(id, instance);
            }
            else throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "Unknown Story Control operation " + request.Operation);
            token.ThrowIfCancellationRequested();
            if (disposed) throw new ObjectDisposedException(nameof(StoryInstanceManager));
            if (instance.Id == ownerId && request.WaitForCompletion)
                throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "A story cannot wait for its own completion");
            if (instance.Execution == null || instance.Execution.IsCompleted && !instance.Runtime.IsCompleted)
            {
                if (instance.Runtime.Status == "failed") throw instance.Runtime.Diagnostic ??
                    new StoryRuntimeException("INVALID_STATE", "Restore a valid instance state before resuming a failed story");
                instance.Cancellation?.Dispose();
                instance.Cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                instance.Execution = instance.Runtime.RunAsync(PlaybackMode, instance.Cancellation.Token);
                Observe(instance, instance.Execution);
            }
            if (request.WaitForCompletion && instance.Execution != null)
            {
                Instance owner = null;
                if (ownerId != null && instances.TryGetValue(ownerId, out owner))
                {
                    var cursor = instance;
                    var visited = new HashSet<string>();
                    while (cursor != null && visited.Add(cursor.Id))
                    {
                        if (cursor.Id == ownerId) throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "Story instances cannot wait in a cycle");
                        cursor = cursor.WaitingFor != null && instances.TryGetValue(cursor.WaitingFor, out var next) ? next : null;
                    }
                    owner.WaitingFor = instance.Id;
                }
                var cancellation = instance.Cancellation;
                try
                {
                    using (token.Register(() => {
                        try { cancellation?.Cancel(); } catch (ObjectDisposedException) { }
                    })) await instance.Execution;
                    token.ThrowIfCancellationRequested();
                }
                finally { if (owner != null) owner.WaitingFor = null; }
            }
            // The caller's control flow advances exactly as in the TypeScript adapter contract.
            return Result(instance, request.WaitForCompletion || instance.Runtime.IsCompleted);
        }

        private Instance Create(string id, string storyId, StoryProgram program)
        {
            var host = adapterFactory(id) ?? throw new ArgumentException("Adapter factory returned null");
            var routed = new InstanceAdapter(host, this, id);
            return new Instance { Id = id, StoryId = storyId, Runtime = new StoryRuntime(program, routed, storyId) };
        }
        private Instance Find(string id)
        {
            if (id == null || !instances.TryGetValue(id, out var instance))
                throw new StoryRuntimeException("INVALID_ADAPTER_RESULT", "Unknown Story instance " + id);
            return instance;
        }
        private static StoryControlResult Result(Instance instance, bool includeValues = true)
        {
            var values = new JObject();
            if (includeValues) foreach (var variable in instance.Runtime.Variables) values[variable.Key] = variable.Value.DeepClone();
            return new StoryControlResult { InstanceId = instance.Id, Values = values };
        }
        private void Observe(Instance instance, Task task)
        {
            _ = task.ContinueWith(completed => {
                var cause = completed.Exception?.GetBaseException();
                var diagnostic = cause as StoryRuntimeException ?? new StoryRuntimeException("ADAPTER_ERROR",
                    cause?.Message ?? "Background Story failed", "$", instance.StoryId, innerException: cause);
                lock (backgroundErrors) backgroundErrors.Enqueue(diagnostic);
            }, CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
        }
        private static async Task StopInstance(Instance instance)
        {
            instance.Cancellation?.Cancel();
            if (instance.Execution != null)
            {
                try { await instance.Execution; }
                catch (OperationCanceledException) { }
                catch (StoryRuntimeException) { } // Background error remains inspectable in the manager queue.
            }
            instance.Cancellation?.Dispose(); instance.Cancellation = null; instance.Execution = null;
        }

        /// <summary>Cancel and await drivers before taking a session snapshot for persistent storage.</summary>
        public async Task PauseAllAsync()
        {
            foreach (var instance in instances.Values.ToArray()) instance.Cancellation?.Cancel();
            await Task.WhenAll(instances.Values.ToArray().Select(StopInstance));
        }
        public string ExportStateJson()
        {
            var saved = new JObject();
            foreach (var instance in instances.Values)
                saved[instance.Id] = new JObject { ["storyId"] = instance.StoryId, ["state"] = StoryProgram.ReadObject(instance.Runtime.ExportStateJson()) };
            return new JObject { ["format"] = "unity-story-session", ["version"] = 1,
                ["projectContentVersion"] = (string)project.Data["contentVersion"], ["instances"] = saved }.ToString(Formatting.None);
        }
        public void RestoreStateJson(string json)
        {
            if (disposed) throw new ObjectDisposedException(nameof(StoryInstanceManager));
            if (instances.Values.Any(i => i.Execution != null && !i.Execution.IsCompleted))
                throw new StoryRuntimeException("ALREADY_RUNNING", "Pause all instances before restoring a session");
            JObject snapshot;
            try { snapshot = StoryProgram.ReadObject(json); }
            catch (Exception error) { throw new StoryRuntimeException("INVALID_STATE", "Invalid session JSON", innerException: error); }
            if (snapshot["format"]?.Type != JTokenType.String || (string)snapshot["format"] != "unity-story-session" ||
                snapshot["version"]?.Type != JTokenType.Integer || (double?)snapshot["version"] != 1)
                throw new StoryRuntimeException("STATE_VERSION_MISMATCH", "Unsupported session format/version");
            if ((string)snapshot["projectContentVersion"] != (string)project.Data["contentVersion"])
                throw new StoryRuntimeException("PROGRAM_VERSION_MISMATCH", "Session does not match project content version");
            if (!(snapshot["instances"] is JObject saved)) throw new StoryRuntimeException("INVALID_STATE", "Session is missing instances");
            var restored = new Dictionary<string, Instance>();
            foreach (var item in saved.Properties())
            {
                if (!(item.Value is JObject record) || record["storyId"]?.Type != JTokenType.String || !(record["state"] is JObject instanceState) || string.IsNullOrWhiteSpace(item.Name))
                    throw new StoryRuntimeException("INVALID_STATE", "Malformed saved instance " + item.Name, "$.instances." + item.Name);
                var storyId = (string)record["storyId"];
                if (!project.Programs.TryGetValue(storyId ?? "", out var program))
                    throw new StoryRuntimeException("INVALID_STATE", "Session references unknown Story " + storyId);
                var instance = Create(item.Name, storyId, program);
                instance.Runtime.RestoreStateJson(instanceState.ToString(Formatting.None));
                restored.Add(item.Name, instance);
            }
            foreach (var instance in instances.Values) instance.Cancellation?.Dispose();
            instances.Clear(); foreach (var item in restored) instances.Add(item.Key, item.Value);
            lock (backgroundErrors) backgroundErrors.Clear();
        }
        public void Dispose()
        {
            if (disposed) return;
            disposed = true; lifetime.Cancel();
            foreach (var instance in instances.Values) { instance.Cancellation?.Cancel(); instance.Cancellation?.Dispose(); }
            lifetime.Dispose();
        }
        private sealed class InstanceAdapter : StoryAdapter
        {
            private readonly IStoryAdapter host;
            private readonly StoryInstanceManager manager;
            private readonly string ownerId;
            public InstanceAdapter(IStoryAdapter host, StoryInstanceManager manager, string ownerId) { this.host = host; this.manager = manager; this.ownerId = ownerId; }
            public override Task PresentDialogueAsync(DialogueRequest r, PlaybackMode m, CancellationToken c) => host.PresentDialogueAsync(r, m, c);
            public override Task PresentNarrationAsync(NarrationRequest r, PlaybackMode m, CancellationToken c) => host.PresentNarrationAsync(r, m, c);
            public override Task<string> PresentChoiceAsync(ChoiceRequest r, CancellationToken c) => host.PresentChoiceAsync(r, c);
            public override Task<JObject> CallEventAsync(EventRequest r, CancellationToken c) => host.CallEventAsync(r, c);
            public override Task<JObject> WaitForSignalAsync(SignalRequest r, CancellationToken c) => host.WaitForSignalAsync(r, c);
            public override Task<JToken> ReadExternalVariableAsync(JObject d, CancellationToken c) => host.ReadExternalVariableAsync(d, c);
            public override Task WriteExternalVariableAsync(JObject d, JToken v, CancellationToken c) => host.WriteExternalVariableAsync(d, v, c);
            public override Task<string> ResolveTextAsync(string id, string locale, CancellationToken c) => host.ResolveTextAsync(id, locale, c);
            public override Task<StoryControlResult> ControlStoryAsync(StoryControlRequest r, CancellationToken c) => manager.ControlAsync(r, ownerId, c);
        }
    }
}
