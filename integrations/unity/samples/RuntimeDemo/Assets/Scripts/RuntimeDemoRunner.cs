using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEngine;

public sealed class RuntimeDemoRunner : UnityStoryHost
{
    private string _saveJson;
    private string _status = "Speak to the village elder, then choose whether to take the quest.";
    private int _gold = 100;
    private int _savedGold;
    private bool _busy;
    private GUIStyle _heading;
    private GUIStyle _body;

    // The checked-in scene needs no manual component wiring. A scene with its own runner remains usable.
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Bootstrap()
    {
        if (FindObjectOfType<RuntimeDemoRunner>() != null) return;
        var demo = new GameObject("Story Blueprint Runtime Demo");
        demo.AddComponent<RuntimeDemoPresenter>();
        demo.AddComponent<RuntimeDemoRunner>();
    }

    protected override void Awake()
    {
        base.Awake();
        Completed += () => _status = _gold > 100 ? "Quest completed. The village awarded you 500 gold." : "You declined the quest. Restart to explore the other branch.";
        Failed += error => _status = error.Message;
    }

    protected override void ConfigureAdapter(UnityStoryAdapter adapter)
    {
        adapter.RegisterEvent("ev_grant_reward", (request, token) =>
        {
            token.ThrowIfCancellationRequested();
            _gold += request.Arguments.Value<int>("amount");
            // Outputs use the stable output ID, never its display name ("success").
            return Task.FromResult(new JObject { ["evo_success"] = true });
        });
    }

    private void OnGUI()
    {
        if (_heading == null)
        {
            _heading = new GUIStyle(GUI.skin.label) { fontSize = 26, fontStyle = FontStyle.Bold, richText = false };
            _body = new GUIStyle(GUI.skin.label) { fontSize = 17, wordWrap = true, richText = false };
        }
        var width = Mathf.Min(860, Screen.width - 32);
        GUILayout.BeginArea(new Rect((Screen.width - width) / 2, 20, width, 240), GUI.skin.box);
        GUILayout.Label("Story Blueprint · Dragon Quest", _heading);
        GUILayout.Label("Gold: " + _gold + "   |   " + (Presenter == null ? "Loading" : Presenter.PlaybackMode.ToString()), _body);
        GUILayout.Label(_status, _body);
        GUILayout.BeginHorizontal();
        GUI.enabled = !_busy;
        if (GUILayout.Button("Restart", GUILayout.Height(34))) RunDemo(null);
        GUI.enabled = !_busy && IsRunning;
        if (GUILayout.Button("Cancel", GUILayout.Height(34))) { Stop(); _status = "Stopped. Restart or load your saved position."; }
        GUI.enabled = !_busy && Runtime != null;
        if (GUILayout.Button("Save position", GUILayout.Height(34)))
        {
            try { _saveJson = ExportStateJson(); _savedGold = _gold; _status = "Position saved. Load returns to this dialogue, choice, or signal wait."; }
            catch (Exception error) { _status = error.Message; }
        }
        GUI.enabled = !_busy && _saveJson != null;
        if (GUILayout.Button("Load position", GUILayout.Height(34))) RunDemo(_saveJson);
        GUI.enabled = true;
        GUILayout.EndHorizontal();
        var accepted = Runtime != null && Runtime.Variables.TryGetValue("v_quest_accepted", out var value) && value.Value<bool>();
        GUI.enabled = !_busy && IsRunning && accepted && !Presenter.HasPendingInteraction;
        if (GUILayout.Button("Defeat the red dragon", GUILayout.Height(38)))
        {
            SendSignal("sig_boss_slain", new JObject { ["bossId"] = "red_dragon" });
            _status = "Dragon defeated. Returning to the village for your reward…";
        }
        GUI.enabled = true;
        if (accepted && IsRunning && !Presenter.HasPendingInteraction)
            GUILayout.Label("The story is waiting for the game world. Click the dragon button to send its signal.", _body);
        if (LastError != null) GUILayout.Label(LastError, _body);
        GUILayout.EndArea();
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
}
