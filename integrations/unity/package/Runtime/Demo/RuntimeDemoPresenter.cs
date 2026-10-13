using System;
using System.Collections.Generic;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEngine;
using UnityEngine.UI;

// The scene owns every visual element. Edit the prefab to change layout, art or typography.
public sealed class RuntimeDemoPresenter : UnityStoryPresenter
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

    [Header("Game controls")]
    [SerializeField] private Text goldText;
    [SerializeField] private Text statusText;
    [SerializeField] private Text hintText;
    [SerializeField] private Button restartButton;
    [SerializeField] private Button cancelButton;
    [SerializeField] private Button saveButton;
    [SerializeField] private Button loadButton;
    [SerializeField] private Button dragonButton;

    private readonly List<Button> _choices = new List<Button>();

    public event Action RestartRequested;
    public event Action CancelRequested;
    public event Action SaveRequested;
    public event Action LoadRequested;
    public event Action DragonSlainRequested;

    protected override void Awake()
    {
        base.Awake();
        if (dialoguePanel == null || dialogueText == null || continueButton == null ||
            choicePanel == null || choiceContainer == null || choiceButtonTemplate == null)
            throw new InvalidOperationException("RuntimeDemoPresenter needs the UI references from StoryBlueprintRuntimeDemo.prefab.");

        DialoguePresented += OnDialogue;
        NarrationPresented += OnNarration;
        ChoicePresented += OnChoice;
        InteractionCleared += HideInteraction;

        continueButton.onClick.AddListener(Advance);
        playbackButton.onClick.AddListener(TogglePlayback);
        restartButton.onClick.AddListener(RequestRestart);
        cancelButton.onClick.AddListener(RequestCancel);
        saveButton.onClick.AddListener(RequestSave);
        loadButton.onClick.AddListener(RequestLoad);
        dragonButton.onClick.AddListener(RequestDragon);
        choiceButtonTemplate.gameObject.SetActive(false);
        HideInteraction();
    }

    protected override void Update()
    {
        base.Update();
        if (dialoguePanel.activeSelf)
        {
            dialogueText.text = DisplayedText;
            if (continueButtonText != null) continueButtonText.text = IsTyping ? "Reveal text" : "Continue";
            if (playbackButtonText != null)
                playbackButtonText.text = PlaybackMode == PlaybackMode.Manual ? "Auto" : "Manual";
        }
    }

    public void ShowGameState(int gold, string status, bool busy, bool running, bool hasSave, bool accepted)
    {
        if (goldText != null) goldText.text = "Gold: " + gold;
        if (statusText != null) statusText.text = status ?? "";
        if (restartButton != null) restartButton.interactable = !busy;
        if (cancelButton != null) cancelButton.interactable = !busy && running;
        if (saveButton != null) saveButton.interactable = !busy && running;
        if (loadButton != null) loadButton.interactable = !busy && hasSave;
        var waitingForDragon = !busy && running && accepted && !HasPendingInteraction;
        if (dragonButton != null) dragonButton.interactable = waitingForDragon;
        if (hintText != null) hintText.gameObject.SetActive(waitingForDragon);
    }

    private void OnDialogue(DialogueRequest request) { ShowDialogue(CurrentSpeaker); }
    private void OnNarration(NarrationRequest request) { ShowDialogue("Narration"); }

    private void ShowDialogue(string speaker)
    {
        ClearChoices();
        choicePanel.SetActive(false);
        dialoguePanel.SetActive(true);
        if (speakerText != null) speakerText.text = speaker;
        dialogueText.text = DisplayedText;
    }

    private void OnChoice(ChoiceRequest request)
    {
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

    private void RequestRestart() { RestartRequested?.Invoke(); }
    private void RequestCancel() { CancelRequested?.Invoke(); }
    private void RequestSave() { SaveRequested?.Invoke(); }
    private void RequestLoad() { LoadRequested?.Invoke(); }
    private void RequestDragon() { DragonSlainRequested?.Invoke(); }

    protected override void OnDestroy()
    {
        DialoguePresented -= OnDialogue;
        NarrationPresented -= OnNarration;
        ChoicePresented -= OnChoice;
        InteractionCleared -= HideInteraction;
        if (continueButton != null) continueButton.onClick.RemoveListener(Advance);
        if (playbackButton != null) playbackButton.onClick.RemoveListener(TogglePlayback);
        if (restartButton != null) restartButton.onClick.RemoveListener(RequestRestart);
        if (cancelButton != null) cancelButton.onClick.RemoveListener(RequestCancel);
        if (saveButton != null) saveButton.onClick.RemoveListener(RequestSave);
        if (loadButton != null) loadButton.onClick.RemoveListener(RequestLoad);
        if (dragonButton != null) dragonButton.onClick.RemoveListener(RequestDragon);
        base.OnDestroy();
    }
}
