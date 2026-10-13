using System;
using System.IO;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using UnityEngine;
using UnityEngine.Networking;

namespace StoryBlueprint.Unity
{
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class GeneratedStoryHostAttribute : Attribute { }

    /// <summary>Owns one runtime. Stop, reload, and scene destruction cancel every active presentation.</summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(UnityStoryPresenter))]
    public class UnityStoryHost : MonoBehaviour
    {
        [SerializeField] private TextAsset compiledProject;
        [SerializeField] private string streamingAssetsPath = "sample-quest.storyc.json";
        [SerializeField] private string entryStoryId = "";
        [SerializeField] private bool playOnStart = true;
        [SerializeField] private List<UnityStoryExternalFunctionBinding> externalFunctionBindings = new List<UnityStoryExternalFunctionBinding>();
        [SerializeField] private List<UnityStorySignalBinding> signalBindings = new List<UnityStorySignalBinding>();

        private CancellationTokenSource _runCancellation;
        private Task _runTask;
        private bool _destroyed;
        private readonly SemaphoreSlim _startGate = new SemaphoreSlim(1, 1);
        private readonly object _signalGate = new object();
        private readonly Queue<QueuedSignal> _signalsBeforeLoad = new Queue<QueuedSignal>();
        private readonly List<IDisposable> _signalSubscriptions = new List<IDisposable>();

        private sealed class QueuedSignal
        {
            public string Id;
            public JObject Payload;
        }

        public StoryRuntime Runtime { get; private set; }
        public UnityStoryPresenter Presenter { get; private set; }
        public UnityStoryAdapter Adapter { get; private set; }
        public bool IsRunning { get { return _runTask != null && !_runTask.IsCompleted; } }
        public string LastError { get; private set; }
        public event Action Completed;
        public event Action<Exception> Failed;

        protected virtual void Awake()
        {
            Presenter = GetComponent<UnityStoryPresenter>();
            Adapter = new UnityStoryAdapter(Presenter);
            ConfigureAdapter(Adapter);
            BindConfiguredExternalFunctions();
            BindConfiguredSignals();
        }

        protected virtual void ConfigureAdapter(UnityStoryAdapter adapter) { }

        protected virtual async void Start()
        {
            if (!playOnStart) return;
            try { await PlayAsync(); }
            catch (OperationCanceledException) { }
            catch (Exception error) { ReportFailure(error); }
        }

        public async Task PlayAsync(string restoreStateJson = null, CancellationToken cancellationToken = default)
        {
            Task running;
            await _startGate.WaitAsync(cancellationToken);
            try
            {
                if (_destroyed) throw new ObjectDisposedException(nameof(UnityStoryHost));
                await StopCoreAsync();
                if (_destroyed) throw new ObjectDisposedException(nameof(UnityStoryHost));
                cancellationToken.ThrowIfCancellationRequested();
                _runCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                LastError = null;
                _runTask = RunLoadedAsync(restoreStateJson, _runCancellation.Token);
                running = _runTask;
            }
            finally { _startGate.Release(); }
            await running;
        }

        private async Task RunLoadedAsync(string restoreStateJson, CancellationToken token)
        {
            var json = compiledProject != null ? compiledProject.text : await LoadStreamingAssetAsync(streamingAssetsPath, token);
            token.ThrowIfCancellationRequested();
            var project = StoryProject.Parse(json);
            var selectedId = string.IsNullOrWhiteSpace(entryStoryId) ? project.EntryStoryId : entryStoryId;
            if (!project.Programs.TryGetValue(selectedId, out var program))
                throw new StoryRuntimeException("MISSING_STORY", "Story does not exist: " + selectedId, "$.stories", selectedId);
            var storyDefinitions = project.Data["stories"] as JObject;
            var storyDefinition = storyDefinitions == null ? null : storyDefinitions[selectedId] as JObject;
            var characters = storyDefinition == null ? null : storyDefinition["characters"] as JArray;
            if (characters == null) characters = project.Data["characters"] as JArray;
            ConfigureSpeakerNames(program, characters);
            SetRuntime(new StoryRuntime(program, Adapter, selectedId));
            if (restoreStateJson != null) Runtime.RestoreStateJson(restoreStateJson);
            await Runtime.RunAsync(Presenter.PlaybackMode, token);
            token.ThrowIfCancellationRequested();
            Completed?.Invoke();
        }

        private void ConfigureSpeakerNames(StoryProgram program, JArray projectCharacters)
        {
            if (Presenter == null || Presenter.SpeakerResolver != null) return;
            var names = new Dictionary<string, string>(StringComparer.Ordinal);
            // Compiled projects keep resource metadata beside each program, not inside it.
            // Standalone runtime JSON keeps the character list on the program itself.
            var characters = projectCharacters ?? program.Data["characters"] as JArray;
            if (characters != null)
            {
                foreach (var character in characters)
                {
                    var id = (string)character["id"];
                    if (string.IsNullOrWhiteSpace(id)) continue;
                    var displayName = (string)character["displayName"];
                    if (string.IsNullOrWhiteSpace(displayName)) displayName = (string)character["name"];
                    if (!string.IsNullOrWhiteSpace(displayName))
                    {
                        names[id] = displayName;
                        var authoredName = (string)character["name"];
                        if (!string.IsNullOrWhiteSpace(authoredName) && !names.ContainsKey(authoredName))
                            names[authoredName] = displayName;
                    }
                }
            }
            Presenter.SpeakerResolver = id => names.TryGetValue(id, out var name) ? name : id;
        }

        public string ExportStateJson()
        {
            if (Runtime == null) throw new InvalidOperationException("No story has been loaded.");
            return Runtime.ExportStateJson();
        }

        public void SendSignal(string signalId, JObject payload)
        {
            if (string.IsNullOrWhiteSpace(signalId)) throw new ArgumentException("A stable Signal ID is required.", nameof(signalId));
            lock (_signalGate)
            {
                if (Runtime == null)
                {
                    _signalsBeforeLoad.Enqueue(new QueuedSignal { Id = signalId, Payload = payload == null ? new JObject() : (JObject)payload.DeepClone() });
                    return;
                }
                Runtime.SendSignal(signalId, payload);
            }
        }

        private void SetRuntime(StoryRuntime runtime)
        {
            lock (_signalGate)
            {
                Runtime = runtime;
                while (_signalsBeforeLoad.Count > 0)
                {
                    var signal = _signalsBeforeLoad.Dequeue();
                    Runtime.SendSignal(signal.Id, signal.Payload);
                }
            }
        }

        private void BindConfiguredExternalFunctions()
        {
            foreach (var binding in externalFunctionBindings)
            {
                if (binding == null || string.IsNullOrWhiteSpace(binding.FunctionId) || binding.Handler == null) continue;
                var handler = binding.Handler as IUnityStoryExternalFunctionHandler;
                if (handler == null)
                    throw new InvalidOperationException("External Function handler must implement IUnityStoryExternalFunctionHandler: " + binding.FunctionId);
                Adapter.RegisterExternalFunction(binding.FunctionId, handler.InvokeAsync);
            }
        }

        private void BindConfiguredSignals()
        {
            foreach (var binding in signalBindings)
            {
                if (binding == null || string.IsNullOrWhiteSpace(binding.SignalId) || binding.Source == null) continue;
                var source = binding.Source as IUnityStorySignalSource;
                if (source == null)
                    throw new InvalidOperationException("Signal source must implement IUnityStorySignalSource: " + binding.SignalId);
                var signalId = binding.SignalId;
                _signalSubscriptions.Add(source.Subscribe(payload => SendSignal(signalId, payload)));
            }
        }

        public void Stop()
        {
            _runCancellation?.Cancel();
            Presenter?.CancelPresentation();
        }

        public async Task StopAsync()
        {
            await _startGate.WaitAsync();
            try { await StopCoreAsync(); }
            finally { _startGate.Release(); }
        }

        private async Task StopCoreAsync()
        {
            Stop();
            if (_runTask != null)
            {
                try { await _runTask; }
                catch (OperationCanceledException) { }
                catch (Exception) { /* The original PlayAsync caller owns the failure. */ }
            }
            _runCancellation?.Dispose();
            _runCancellation = null;
            _runTask = null;
        }

        public static async Task<string> LoadStreamingAssetAsync(string relativePath, CancellationToken token)
        {
            if (string.IsNullOrWhiteSpace(relativePath)) throw new ArgumentException("A StreamingAssets file path is required.", nameof(relativePath));
            var path = Path.Combine(Application.streamingAssetsPath, relativePath);
            // Android packages and WebGL StreamingAssets use URLs rather than ordinary filesystem paths.
            if (!path.Contains("://") && !path.StartsWith("jar:", StringComparison.Ordinal))
            {
                token.ThrowIfCancellationRequested();
                return File.ReadAllText(path);
            }
            using (var request = UnityWebRequest.Get(path))
            {
                var operation = request.SendWebRequest();
                try
                {
                    while (!operation.isDone) { token.ThrowIfCancellationRequested(); await Task.Yield(); }
                    token.ThrowIfCancellationRequested();
                    if (request.result != UnityWebRequest.Result.Success) throw new IOException("Unable to load " + relativePath + ": " + request.error);
                    return request.downloadHandler.text;
                }
                finally { if (!operation.isDone) request.Abort(); }
            }
        }

        protected void ReportFailure(Exception error)
        {
            LastError = error.Message;
            Failed?.Invoke(error);
            Debug.LogException(error, this);
        }

        protected virtual void OnDisable() { Stop(); }
        protected virtual void OnDestroy()
        {
            _destroyed = true;
            Stop();
            foreach (var subscription in _signalSubscriptions) subscription?.Dispose();
            _signalSubscriptions.Clear();
            _runCancellation?.Dispose();
            _runCancellation = null;
        }
    }
}
