using System;
using StoryBlueprint.Unity;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

/// <summary>Builds the editable generic player UI prefab; all visual objects remain regular uGUI assets.</summary>
public static class StoryPlayerPrefabBuilder
{
    public const string PrefabPath = "Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintStoryPlayer.prefab";
    private static Font _font;

    public static void Build()
    {
        _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var root = new GameObject("Story Blueprint Story Player");
        root.AddComponent<UnityMainThreadDispatcher>();
        var presenter = root.AddComponent<StoryPlayerPresenter>();

        var canvasObject = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvasObject.transform.SetParent(root.transform, false);
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        scaler.matchWidthOrHeight = 0.5f;

        var statusPanel = Panel("PlayerControls", canvasObject.transform, new Vector2(.5f, 1), new Vector2(.5f, 1), new Vector2(.5f, 1), new Vector2(0, -18), new Vector2(860, 105));
        TextAt("Title", statusPanel.transform, "Story", 24, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -12), new Vector2(820, 32));
        var status = TextAt("Status", statusPanel.transform, "Ready", 16, FontStyle.Normal, TextAnchor.MiddleLeft, new Vector2(20, -47), new Vector2(820, 24));
        var restart = ButtonAt("RestartButton", statusPanel.transform, "Restart", new Vector2(20, -78), new Vector2(160, 34));
        var cancel = ButtonAt("CancelButton", statusPanel.transform, "Cancel", new Vector2(190, -78), new Vector2(150, 34));
        var save = ButtonAt("SaveButton", statusPanel.transform, "Save position", new Vector2(350, -78), new Vector2(220, 34));
        var load = ButtonAt("LoadButton", statusPanel.transform, "Load position", new Vector2(580, -78), new Vector2(240, 34));

        var dialoguePanel = Panel("DialoguePanel", canvasObject.transform, new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(0, 20), new Vector2(860, 230));
        var speaker = TextAt("Speaker", dialoguePanel.transform, "Speaker", 20, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -14), new Vector2(820, 28));
        var dialogue = TextAt("Dialogue", dialoguePanel.transform, "", 22, FontStyle.Normal, TextAnchor.UpperLeft, new Vector2(20, -53), new Vector2(820, 116));
        var continueButton = ButtonAt("ContinueButton", dialoguePanel.transform, "Continue", new Vector2(20, -184), new Vector2(220, 36));
        var playback = ButtonAt("PlaybackButton", dialoguePanel.transform, "Auto", new Vector2(250, -184), new Vector2(180, 36));

        var choicePanel = Panel("ChoicePanel", canvasObject.transform, new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(0, 20), new Vector2(860, 340));
        var choicePrompt = TextAt("ChoicePrompt", choicePanel.transform, "Choose an option", 21, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -16), new Vector2(820, 42));
        var choices = Rect("ChoiceOptions", choicePanel.transform, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, 1), new Vector2(20, -69), new Vector2(820, 255));
        var layout = choices.gameObject.AddComponent<VerticalLayoutGroup>();
        layout.spacing = 8;
        layout.childControlHeight = true;
        layout.childForceExpandHeight = false;
        layout.childControlWidth = true;
        layout.childForceExpandWidth = true;
        var template = ButtonAt("ChoiceButtonTemplate", choices, "Choice", Vector2.zero, new Vector2(820, 46));
        var element = template.gameObject.AddComponent<LayoutElement>();
        element.minHeight = 46;
        element.preferredHeight = 46;
        template.gameObject.SetActive(false);

        var eventSystem = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
        eventSystem.transform.SetParent(root.transform, false);

        var view = new SerializedObject(presenter);
        Set(view, "dialoguePanel", dialoguePanel);
        Set(view, "speakerText", speaker);
        Set(view, "dialogueText", dialogue);
        Set(view, "continueButton", continueButton);
        Set(view, "continueButtonText", continueButton.GetComponentInChildren<Text>());
        Set(view, "playbackButton", playback);
        Set(view, "playbackButtonText", playback.GetComponentInChildren<Text>());
        Set(view, "choicePanel", choicePanel);
        Set(view, "choicePromptText", choicePrompt);
        Set(view, "choiceContainer", choices);
        Set(view, "choiceButtonTemplate", template);
        Set(view, "statusText", status);
        Set(view, "restartButton", restart);
        Set(view, "cancelButton", cancel);
        Set(view, "saveButton", save);
        Set(view, "loadButton", load);
        view.ApplyModifiedPropertiesWithoutUndo();

        PrefabUtility.SaveAsPrefabAsset(root, PrefabPath, out var saved);
        UnityEngine.Object.DestroyImmediate(root);
        if (!saved) throw new InvalidOperationException("Could not save " + PrefabPath);
        AssetDatabase.SaveAssets();
        Debug.Log("Rebuilt generic Story Blueprint player prefab: " + PrefabPath);
    }

    private static GameObject Panel(string name, Transform parent, Vector2 min, Vector2 max, Vector2 pivot, Vector2 position, Vector2 size)
    {
        var panel = Rect(name, parent, min, max, pivot, position, size).gameObject;
        panel.AddComponent<Image>().color = new Color(.08f, .11f, .16f, .94f);
        return panel;
    }

    private static Text TextAt(string name, Transform parent, string text, int fontSize, FontStyle style, TextAnchor alignment, Vector2 position, Vector2 size)
    {
        var rect = Rect(name, parent, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, 1), position, size);
        var label = rect.gameObject.AddComponent<Text>();
        label.font = _font;
        label.text = text;
        label.fontSize = fontSize;
        label.fontStyle = style;
        label.alignment = alignment;
        label.color = Color.white;
        label.horizontalOverflow = HorizontalWrapMode.Wrap;
        label.verticalOverflow = VerticalWrapMode.Truncate;
        return label;
    }

    private static Button ButtonAt(string name, Transform parent, string label, Vector2 position, Vector2 size)
    {
        var rect = Rect(name, parent, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, 1), position, size);
        var image = rect.gameObject.AddComponent<Image>();
        image.color = new Color(.22f, .39f, .62f, 1);
        var button = rect.gameObject.AddComponent<Button>();
        button.targetGraphic = image;
        var caption = Rect("Label", rect, Vector2.zero, Vector2.one, new Vector2(.5f, .5f), Vector2.zero, Vector2.zero);
        caption.offsetMin = Vector2.zero;
        caption.offsetMax = Vector2.zero;
        var text = caption.gameObject.AddComponent<Text>();
        text.font = _font;
        text.text = label;
        text.fontSize = 17;
        text.alignment = TextAnchor.MiddleCenter;
        text.color = Color.white;
        return button;
    }

    private static RectTransform Rect(string name, Transform parent, Vector2 min, Vector2 max, Vector2 pivot, Vector2 position, Vector2 size)
    {
        var obj = new GameObject(name, typeof(RectTransform));
        var rect = obj.GetComponent<RectTransform>();
        rect.SetParent(parent, false);
        rect.anchorMin = min;
        rect.anchorMax = max;
        rect.pivot = pivot;
        rect.anchoredPosition = position;
        rect.sizeDelta = size;
        return rect;
    }

    private static void Set(SerializedObject target, string field, UnityEngine.Object value)
    {
        var property = target.FindProperty(field);
        if (property == null) throw new InvalidOperationException("Missing serialized field: " + field);
        property.objectReferenceValue = value;
    }
}
