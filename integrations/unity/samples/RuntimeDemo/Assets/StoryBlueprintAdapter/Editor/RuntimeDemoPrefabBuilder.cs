using UnityEditor;
using StoryBlueprint.Unity;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

// Rebuilds the editable sample prefab. Runtime code never constructs UI objects.
public static class RuntimeDemoPrefabBuilder
{
    private const string PrefabPath = "Assets/StoryBlueprintAdapter/Runtime/Demo/StoryBlueprintRuntimeDemo.prefab";
    private static Font _font;

    public static void Build()
    {
        _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        var root = new GameObject("Story Blueprint Runtime Demo");
        root.AddComponent<UnityMainThreadDispatcher>();
        var presenter = root.AddComponent<RuntimeDemoPresenter>();
        var runner = root.AddComponent<RuntimeDemoRunner>();

        var canvasObject = new GameObject("Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvasObject.transform.SetParent(root.transform, false);
        var canvas = canvasObject.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = canvasObject.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1280, 720);
        scaler.matchWidthOrHeight = 0.5f;

        var statusPanel = Panel("StatusPanel", canvasObject.transform, new Vector2(.5f, 1), new Vector2(.5f, 1), new Vector2(.5f, 1), new Vector2(0, -20), new Vector2(860, 220));
        TextAt("Title", statusPanel.transform, "Story Blueprint · Dragon Quest", 24, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -15), new Vector2(820, 32));
        var gold = TextAt("Gold", statusPanel.transform, "Gold: 100", 18, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -52), new Vector2(820, 26));
        var status = TextAt("Status", statusPanel.transform, "Speak to the village elder.", 17, FontStyle.Normal, TextAnchor.UpperLeft, new Vector2(20, -82), new Vector2(820, 42));
        var restart = ButtonAt("RestartButton", statusPanel.transform, "Restart", new Vector2(20, -128), new Vector2(160, 36));
        var cancel = ButtonAt("CancelButton", statusPanel.transform, "Cancel", new Vector2(190, -128), new Vector2(160, 36));
        var save = ButtonAt("SaveButton", statusPanel.transform, "Save position", new Vector2(360, -128), new Vector2(220, 36));
        var load = ButtonAt("LoadButton", statusPanel.transform, "Load position", new Vector2(590, -128), new Vector2(250, 36));
        var dragon = ButtonAt("DragonButton", statusPanel.transform, "Defeat the red dragon", new Vector2(20, -173), new Vector2(260, 36));
        var hint = TextAt("SignalHint", statusPanel.transform, "The story is waiting for the game world. Send its dragon signal.", 15, FontStyle.Normal, TextAnchor.MiddleLeft, new Vector2(295, -173), new Vector2(545, 36));

        var dialoguePanel = Panel("DialoguePanel", canvasObject.transform, new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(0, 20), new Vector2(860, 210));
        var speaker = TextAt("Speaker", dialoguePanel.transform, "Speaker", 20, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -14), new Vector2(820, 28));
        var dialogue = TextAt("Dialogue", dialoguePanel.transform, "", 22, FontStyle.Normal, TextAnchor.UpperLeft, new Vector2(20, -53), new Vector2(820, 100));
        var continueButton = ButtonAt("ContinueButton", dialoguePanel.transform, "Continue", new Vector2(20, -159), new Vector2(220, 36));
        var playback = ButtonAt("PlaybackButton", dialoguePanel.transform, "Auto", new Vector2(250, -159), new Vector2(180, 36));

        var choicePanel = Panel("ChoicePanel", canvasObject.transform, new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(.5f, 0), new Vector2(0, 20), new Vector2(860, 320));
        var choicePrompt = TextAt("ChoicePrompt", choicePanel.transform, "Choose an option", 21, FontStyle.Bold, TextAnchor.MiddleLeft, new Vector2(20, -16), new Vector2(820, 42));
        var choices = Rect("ChoiceOptions", choicePanel.transform, new Vector2(0, 1), new Vector2(0, 1), new Vector2(0, 1), new Vector2(20, -69), new Vector2(820, 235));
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
        Set(view, "goldText", gold);
        Set(view, "statusText", status);
        Set(view, "hintText", hint);
        Set(view, "restartButton", restart);
        Set(view, "cancelButton", cancel);
        Set(view, "saveButton", save);
        Set(view, "loadButton", load);
        Set(view, "dragonButton", dragon);
        view.ApplyModifiedPropertiesWithoutUndo();

        var project = AssetDatabase.LoadAssetAtPath<TextAsset>(
            "Assets/StoryBlueprintAdapter/Runtime/Demo/sample-quest.storyc.json");
        if (project == null) throw new System.InvalidOperationException("Demo story asset is missing.");
        var host = new SerializedObject(runner);
        host.FindProperty("compiledProject").objectReferenceValue = project;
        host.FindProperty("streamingAssetsPath").stringValue = "";
        host.FindProperty("playOnStart").boolValue = true;
        var externalFunctions = host.FindProperty("externalFunctionBindings");
        externalFunctions.arraySize = 1;
        externalFunctions.GetArrayElementAtIndex(0).FindPropertyRelative("functionId").stringValue = "ev_grant_reward";
        externalFunctions.GetArrayElementAtIndex(0).FindPropertyRelative("handler").objectReferenceValue = runner;
        var signals = host.FindProperty("signalBindings");
        signals.arraySize = 1;
        signals.GetArrayElementAtIndex(0).FindPropertyRelative("signalId").stringValue = "sig_boss_slain";
        signals.GetArrayElementAtIndex(0).FindPropertyRelative("source").objectReferenceValue = runner;
        host.ApplyModifiedPropertiesWithoutUndo();

        PrefabUtility.SaveAsPrefabAsset(root, PrefabPath, out var saved);
        Object.DestroyImmediate(root);
        if (!saved) throw new System.InvalidOperationException("Could not save " + PrefabPath);
        AssetDatabase.SaveAssets();
        Debug.Log("Rebuilt editable demo prefab: " + PrefabPath);
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

    private static void Set(SerializedObject target, string field, Object value)
    {
        var property = target.FindProperty(field);
        if (property == null) throw new System.InvalidOperationException("Missing serialized field: " + field);
        property.objectReferenceValue = value;
    }
}
