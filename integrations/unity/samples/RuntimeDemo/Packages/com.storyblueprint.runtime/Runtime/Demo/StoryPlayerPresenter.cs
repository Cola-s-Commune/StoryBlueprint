using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEngine;
using UnityEngine.UI;

/// <summary>Editable, story-agnostic uGUI presenter for playing any compiled Story Blueprint project.</summary>
public sealed class StoryPlayerPresenter : UnityStoryPresenter
{
    [Header("Story panels")]
    [SerializeField] private GameObject dialoguePanel;
    [SerializeField] private Text speakerText;
    [SerializeField] private Text dialogueText;
    [SerializeField] private Button continueButton;
    [SerializeField] private Text continueButtonText;
    [SerializeField] private Button playbackButton;
    [SerializeField] private Text playbackButtonText;
    [SerializeField] private GameObject choicePanel;
    [SerializeField] private Text choicePromptText;
    [SerializeField] private Transform choiceContainer;
    [SerializeField] private Button choiceButtonTemplate;

    [Header("Player controls")]
    [SerializeField] private Text statusText;
    [SerializeField] private Button restartButton;
    [SerializeField] private Button cancelButton;
    [SerializeField] private Button saveButton;
    [SerializeField] private Button loadButton;

    private readonly List<Button> _choices = new List<Button>();
    private UnityStoryHost _host;
    private string _savedState;
    private int _operationVersion;

    protected override void Awake()
    {
        base.Awake();
        if (dialoguePanel == null || dialogueText == null || continueButton == null ||
            choicePanel == null || choiceContainer == null || choiceButtonTemplate == null)
            throw new InvalidOperationException("StoryPlayerPresenter requires the references from StoryPlayer.prefab.");

        _host = GetComponent<UnityStoryHost>();
        if (_host != null)
        {
            _host.Completed += OnStoryCompleted;
            _host.Failed += OnStoryFailed;
        }
        DialoguePresented += OnDialogue;
        NarrationPresented += OnNarration;
        ChoicePresented += OnChoice;
        InteractionCleared += HideInteraction;

        continueButton.onClick.AddListener(Advance);
        if (playbackButton != null) playbackButton.onClick.AddListener(TogglePlayback);
        if (restartButton != null) restartButton.onClick.AddListener(RestartStory);
        if (cancelButton != null) cancelButton.onClick.AddListener(CancelStory);
        if (saveButton != null) saveButton.onClick.AddListener(SaveStory);
        if (loadButton != null) loadButton.onClick.AddListener(LoadStory);
        choiceButtonTemplate.gameObject.SetActive(false);
        HideInteraction();
        SetStatus("Ready");
    }

    protected override void Update()
    {
        base.Update();
        if (dialoguePanel != null && dialoguePanel.activeSelf)
        {
            dialogueText.text = DisplayedText;
            if (continueButtonText != null) continueButtonText.text = IsTyping ? "Reveal text" : "Continue";
            if (playbackButtonText != null)
                playbackButtonText.text = PlaybackMode == PlaybackMode.Manual ? "Auto" : "Manual";
        }
        if (statusText != null && statusText.text == "Ready" && _host != null && _host.IsRunning)
            SetStatus("Running story...");
        if (cancelButton != null) cancelButton.interactable = HasPendingInteraction || (_host != null && _host.IsRunning);
        if (saveButton != null) saveButton.interactable = _host != null && _host.Runtime != null;
        if (loadButton != null) loadButton.interactable = !string.IsNullOrEmpty(_savedState);
    }

    private void OnDialogue(DialogueRequest request) { ShowDialogue(CurrentSpeaker); SetStatus("Dialogue"); }
    private void OnNarration(NarrationRequest request) { ShowDialogue("Narration"); SetStatus("Narration"); }

    private void ShowDialogue(string speaker)
    {
        ClearChoices();
        choicePanel.SetActive(false);
        dialoguePanel.SetActive(true);
        if (speakerText != null) speakerText.text = string.IsNullOrWhiteSpace(speaker) ? "Narration" : speaker;
        dialogueText.text = DisplayedText;
    }

    private void OnChoice(ChoiceRequest request)
    {
        SetStatus("Choose an option");
        ClearChoices();
        dialoguePanel.SetActive(false);
        choicePanel.SetActive(true);
        if (choicePromptText != null) choicePromptText.text = request.Prompt ?? "Choose an option";
        foreach (var option in request.Options)
        {
            var button = Instantiate(choiceButtonTemplate, choiceContainer);
            button.gameObject.SetActive(true);
            button.interactable = option.Enabled;
            var label = button.GetComponentInChildren<Text>();
            if (label != null) label.text = option.Text;
            var optionId = option.Id;
            button.onClick.AddListener(() => SelectChoice(optionId));
            _choices.Add(button);
        }
    }

    private void HideInteraction()
    {
        if (dialoguePanel != null) dialoguePanel.SetActive(false);
        if (choicePanel != null) choicePanel.SetActive(false);
        ClearChoices();
    }

    private void ClearChoices()
    {
        foreach (var button in _choices)
            if (button != null) Destroy(button.gameObject);
        _choices.Clear();
    }

    private void TogglePlayback()
    {
        SetPlaybackMode(PlaybackMode == PlaybackMode.Manual ? PlaybackMode.Automatic : PlaybackMode.Manual);
    }

    private async void RestartStory()
    {
        if (_host == null) return;
        await RunHostOperation(() => _host.PlayAsync());
    }

    private void CancelStory()
    {
        if (_host == null) return;
        _operationVersion++;
        _host.Stop();
        SetStatus("Story cancelled.");
    }

    private void SaveStory()
    {
        try
        {
            _savedState = _host.ExportStateJson();
            SetStatus("Story position saved.");
        }
        catch (Exception error) { SetStatus(error.Message); }
    }

    private async void LoadStory()
    {
        if (_host == null || string.IsNullOrEmpty(_savedState)) return;
        var state = _savedState;
        await RunHostOperation(() => _host.PlayAsync(state));
    }

    private async Task RunHostOperation(Func<Task> operation)
    {
        var version = ++_operationVersion;
        SetStatus("Running story...");
        try
        {
            await operation();
        }
        catch (OperationCanceledException) { if (version == _operationVersion) SetStatus("Story cancelled."); }
        catch (Exception error) { if (version == _operationVersion) SetStatus(error.Message); }
    }

    private void SetStatus(string message)
    {
        if (statusText != null) statusText.text = message ?? string.Empty;
    }

    private void OnStoryCompleted() { SetStatus("Story completed."); }
    private void OnStoryFailed(Exception error) { SetStatus(error.Message); }

    protected override void OnDestroy()
    {
        DialoguePresented -= OnDialogue;
        NarrationPresented -= OnNarration;
        ChoicePresented -= OnChoice;
        InteractionCleared -= HideInteraction;
        if (_host != null)
        {
            _host.Completed -= OnStoryCompleted;
            _host.Failed -= OnStoryFailed;
        }
        if (continueButton != null) continueButton.onClick.RemoveListener(Advance);
        if (playbackButton != null) playbackButton.onClick.RemoveListener(TogglePlayback);
        if (restartButton != null) restartButton.onClick.RemoveListener(RestartStory);
        if (cancelButton != null) cancelButton.onClick.RemoveListener(CancelStory);
        if (saveButton != null) saveButton.onClick.RemoveListener(SaveStory);
        if (loadButton != null) loadButton.onClick.RemoveListener(LoadStory);
        base.OnDestroy();
    }
}
