using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEngine;

public sealed class RuntimeDemoRunner : UnityStoryHost, IUnityStoryExternalFunctionHandler, IUnityStorySignalSource
{
    private string _saveJson;
    private string _status = "Speak to the village elder, then choose whether to take the quest.";
    private int _gold = 100;
    private int _savedGold;
    private bool _busy;
    private RuntimeDemoPresenter _view;
    private event Action<JObject> _signalRaised;

    private sealed class SignalSubscription : IDisposable
    {
        private Action _dispose;
        public SignalSubscription(Action dispose) { _dispose = dispose; }
        public void Dispose() { var dispose = _dispose; _dispose = null; dispose?.Invoke(); }
    }

    protected override void Awake()
    {
        base.Awake();
        _view = Presenter as RuntimeDemoPresenter;
        if (_view == null) throw new InvalidOperationException("RuntimeDemoRunner needs RuntimeDemoPresenter on the same prefab.");
        _view.RestartRequested += Restart;
        _view.CancelRequested += Cancel;
        _view.SaveRequested += Save;
        _view.LoadRequested += Load;
        _view.DragonSlainRequested += DefeatDragon;
        Completed += () => _status = _gold > 100 ? "Quest completed. The village awarded you 500 gold." : "You declined the quest. Restart to explore the other branch.";
        Failed += error => _status = error.Message;
    }

    public Task<JObject> InvokeAsync(EventRequest request, System.Threading.CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        _gold += request.Arguments.Value<int>("amount");
        // Outputs use the stable output ID, never their display name ("success").
        return Task.FromResult(new JObject { ["evo_success"] = true });
    }

    public IDisposable Subscribe(Action<JObject> onSignal)
    {
        _signalRaised += onSignal;
        return new SignalSubscription(() => _signalRaised -= onSignal);
    }

    private void Update()
    {
        var accepted = Runtime != null && Runtime.Variables.TryGetValue("v_quest_accepted", out var value) && value.Value<bool>();
        if (_view != null) _view.ShowGameState(_gold, _status, _busy, IsRunning, _saveJson != null, accepted);
    }

    private void Restart() { RunDemo(null); }
    private void Cancel() { Stop(); _status = "Stopped. Restart or load your saved position."; }
    private void Load() { if (_saveJson != null) RunDemo(_saveJson); }

    private void Save()
    {
        try { _saveJson = ExportStateJson(); _savedGold = _gold; _status = "Position saved. Load returns to this dialogue, choice, or signal wait."; }
        catch (Exception error) { _status = error.Message; }
    }

    private void DefeatDragon()
    {
        _signalRaised?.Invoke(new JObject { ["bossId"] = "red_dragon" });
        _status = "Dragon defeated. Returning to the village for your reward…";
    }

    private async void RunDemo(string state)
    {
        if (_busy) return;
        _busy = true;
        try
        {
            await StopAsync();
            _gold = state == null ? 100 : _savedGold;
            _status = state == null ? "Speak to the village elder, then choose whether to take the quest." : "Position restored.";
            var playing = PlayAsync(state);
            _busy = false;
            await playing;
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { ReportFailure(error); }
        finally { _busy = false; }
    }

    protected override void OnDestroy()
    {
        if (_view != null)
        {
            _view.RestartRequested -= Restart;
            _view.CancelRequested -= Cancel;
            _view.SaveRequested -= Save;
            _view.LoadRequested -= Load;
            _view.DragonSlainRequested -= DefeatDragon;
        }
        base.OnDestroy();
    }
}
