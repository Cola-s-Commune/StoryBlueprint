using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using UnityEngine;
using UnityEngine.Networking;

namespace StoryBlueprint.Unity
{
    /// <summary>Owns one runtime. Stop, reload, and scene destruction cancel every active presentation.</summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(UnityStoryPresenter))]
    public class UnityStoryHost : MonoBehaviour
    {
        [SerializeField] private TextAsset compiledProject;
        [SerializeField] private string streamingAssetsPath = "sample-quest.storyc.json";
        [SerializeField] private string entryStoryId = "";
        [SerializeField] private bool playOnStart = true;

        private CancellationTokenSource _runCancellation;
        private Task _runTask;
        private bool _destroyed;
        private readonly SemaphoreSlim _startGate = new SemaphoreSlim(1, 1);

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
            Runtime = new StoryRuntime(program, Adapter, selectedId);
            if (restoreStateJson != null) Runtime.RestoreStateJson(restoreStateJson);
            await Runtime.RunAsync(Presenter.PlaybackMode, token);
            token.ThrowIfCancellationRequested();
            Completed?.Invoke();
        }

        public string ExportStateJson()
        {
            if (Runtime == null) throw new InvalidOperationException("No story has been loaded.");
            return Runtime.ExportStateJson();
        }

        public void SendSignal(string signalId, JObject payload)
        {
            if (Runtime == null) throw new InvalidOperationException("No story has been loaded.");
            Runtime.SendSignal(signalId, payload);
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
            _runCancellation?.Dispose();
            _runCancellation = null;
        }
    }
}
