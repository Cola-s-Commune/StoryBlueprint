using System;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public sealed class UnityStoryImporterWindow : EditorWindow
{
    private const string PendingClassKey = "StoryBlueprint.Import.PendingClass";
    private const string PendingJsonKey = "StoryBlueprint.Import.PendingJson";
    private const string PendingObjectNameKey = "StoryBlueprint.Import.PendingObjectName";
    private const string PendingPlayOnStartKey = "StoryBlueprint.Import.PendingPlayOnStart";

    private string _sourcePath;
    private StoryProject _project;
    private JArray _functions;
    private JArray _signals;
    private string _error;
    private string _status;
    private bool _playOnStart = true;

    public static void Open()
    {
        var window = GetWindow<UnityStoryImporterWindow>("Story Blueprint");
        window.minSize = new Vector2(460, 360);
        window.Show();
    }

    private void OnGUI()
    {
        var importPending = EditorPrefs.HasKey(PendingClassKey);
        EditorGUILayout.LabelField("Import a Story Blueprint project", EditorStyles.boldLabel);
        EditorGUILayout.HelpBox("Choose a compiled .storyc.json file. Unity will copy it into Assets, generate an editable typed Host script, wait for compilation, and add a configured Host GameObject to the open scene.", MessageType.Info);

        EditorGUILayout.BeginHorizontal();
        using (new EditorGUI.DisabledScope(importPending))
        {
            EditorGUILayout.TextField("Project JSON", _sourcePath ?? string.Empty);
            if (GUILayout.Button("Browse...", GUILayout.Width(90))) ChooseFile();
        }
        EditorGUILayout.EndHorizontal();

        if (_project != null)
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("Story", _project.Data["displayName"]?.ToString() ?? _project.Data["name"]?.ToString() ?? Path.GetFileNameWithoutExtension(_sourcePath));
            EditorGUILayout.LabelField("Entry Story ID", _project.EntryStoryId ?? "(none)");
            EditorGUILayout.LabelField("External Functions", _functions.Count.ToString());
            foreach (var definition in _functions.OfType<JObject>())
                EditorGUILayout.LabelField("  " + DefinitionName(definition), FunctionSignature(definition));
            EditorGUILayout.LabelField("Signals", _signals.Count.ToString());
            foreach (var definition in _signals.OfType<JObject>())
                EditorGUILayout.LabelField("  " + DefinitionName(definition), FunctionSignature(definition));
            EditorGUILayout.Space();
            _playOnStart = EditorGUILayout.Toggle("Play On Start", _playOnStart);
            EditorGUILayout.HelpBox("Generated External Function methods contain TODO stubs and throw until you implement them. Signal methods are generated for your game code to call.", MessageType.None);
        }

        if (!string.IsNullOrEmpty(_error))
            EditorGUILayout.HelpBox(_error, MessageType.Error);
        if (importPending)
            EditorGUILayout.HelpBox("Waiting for Unity to compile the generated Host, then add it to the current scene...", MessageType.Info);
        else if (!string.IsNullOrEmpty(_status))
            EditorGUILayout.HelpBox(_status, MessageType.Info);

        GUILayout.FlexibleSpace();
        using (new EditorGUI.DisabledScope(_project == null || importPending))
        {
            if (GUILayout.Button("Import, Generate Host, and Add to Scene", GUILayout.Height(34)))
                ImportAndCreateHost();
        }
    }

    private void ChooseFile()
    {
        var path = EditorUtility.OpenFilePanel("Select compiled Story Blueprint JSON", string.IsNullOrEmpty(_sourcePath) ? Application.dataPath : Path.GetDirectoryName(_sourcePath), "json");
        if (string.IsNullOrEmpty(path)) return;
        _sourcePath = path;
        LoadProject();
    }

    private void LoadProject()
    {
        _project = null;
        _functions = null;
        _signals = null;
        _error = null;
        try
        {
            if (string.IsNullOrWhiteSpace(_sourcePath) || !File.Exists(_sourcePath))
                throw new FileNotFoundException("Select an existing Story Blueprint JSON file.", _sourcePath);
            var json = File.ReadAllText(_sourcePath, Encoding.UTF8);
            var project = StoryProject.Parse(json);
            if (project.Data["format"]?.ToString() != "story-blueprint-compiled-project")
                throw new InvalidDataException("This import window requires a compiled project (.storyc.json), which contains the External Function and Signal declarations.");
            if (project.Programs.Count == 0)
                throw new InvalidDataException("The compiled project contains no stories.");
            _project = project;
            _functions = project.Data["events"] as JArray ?? new JArray();
            _signals = project.Data["signals"] as JArray ?? new JArray();
        }
        catch (Exception exception)
        {
            _error = exception.Message;
        }
    }

    private void ImportAndCreateHost()
    {
        try
        {
            LoadProject();
            if (_project == null) return;

            var jsonAssetPath = ImportJsonAsset(_sourcePath);
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(jsonAssetPath);
            if (asset == null) throw new InvalidOperationException("Unity could not load the imported JSON asset: " + jsonAssetPath);

            var classStem = "StoryBlueprintGenerated_" + MakeIdentifier(Path.GetFileNameWithoutExtension(_sourcePath));
            var scriptPath = CreateUniqueScriptPath(classStem, out var className);
            var objectName = (string)(_project.Data["displayName"] ?? _project.Data["name"]) ?? Path.GetFileNameWithoutExtension(_sourcePath);
            objectName = string.IsNullOrWhiteSpace(objectName) ? "Story Blueprint Host" : objectName + " Story Host";

            EditorPrefs.SetString(PendingClassKey, className);
            EditorPrefs.SetString(PendingJsonKey, jsonAssetPath);
            EditorPrefs.SetString(PendingObjectNameKey, objectName);
            EditorPrefs.SetBool(PendingPlayOnStartKey, _playOnStart);

            File.WriteAllText(scriptPath, UnityStoryHostEditor.BuildHostSource(className, _functions, _signals), new UTF8Encoding(false));
            AssetDatabase.ImportAsset(scriptPath, ImportAssetOptions.ForceSynchronousImport);
            StoryBlueprintImportFinalizer.BeginWatching();

            _error = null;
            Selection.activeObject = AssetDatabase.LoadAssetAtPath<MonoScript>(scriptPath);
            EditorGUIUtility.PingObject(Selection.activeObject);
            _status = "Import started. The Host GameObject will be added after Unity finishes compiling.";
            _project = null;
            _functions = null;
            _signals = null;
        }
        catch (Exception exception)
        {
            _error = exception.Message;
            Debug.LogException(exception);
        }
    }

    private static string ImportJsonAsset(string sourcePath)
    {
        const string folder = "Assets/StoryBlueprintStories";
        if (!AssetDatabase.IsValidFolder(folder))
        {
            if (!AssetDatabase.IsValidFolder("Assets")) throw new InvalidOperationException("Unity Assets folder was not found.");
            AssetDatabase.CreateFolder("Assets", "StoryBlueprintStories");
        }

        var sourceFullPath = Path.GetFullPath(sourcePath);
        var assetsFullPath = Path.GetFullPath(Application.dataPath).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var prefix = assetsFullPath + Path.DirectorySeparatorChar;
        if (sourceFullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            return "Assets/" + sourceFullPath.Substring(prefix.Length).Replace('\\', '/');

        var target = AssetDatabase.GenerateUniqueAssetPath(folder + "/" + Path.GetFileName(sourcePath));
        File.Copy(sourceFullPath, Path.GetFullPath(target), false);
        AssetDatabase.ImportAsset(target, ImportAssetOptions.ForceSynchronousImport);
        return target;
    }

    private static string CreateUniqueScriptPath(string classStem, out string className)
    {
        var folder = "Assets/StoryBlueprintGenerated";
        if (!AssetDatabase.IsValidFolder(folder)) AssetDatabase.CreateFolder("Assets", "StoryBlueprintGenerated");
        className = classStem;
        var path = folder + "/" + className + ".cs";
        var suffix = 2;
        while (File.Exists(path) || File.Exists(path + ".meta") || ClassNameAlreadyExists(className))
        {
            className = classStem + "_" + suffix++;
            path = folder + "/" + className + ".cs";
        }
        return path;
    }

    private static bool ClassNameAlreadyExists(string className)
    {
        return Directory.GetFiles(Application.dataPath, "*.cs", SearchOption.AllDirectories)
            .Any(path => string.Equals(Path.GetFileNameWithoutExtension(path), className, StringComparison.Ordinal));
    }

    private static string DefinitionName(JObject definition)
    {
        return (string)definition["name"] ?? (string)definition["displayName"] ?? (string)definition["id"] ?? "Unnamed";
    }

    private static string FunctionSignature(JObject definition)
    {
        var parameters = (definition["parameters"] as JArray ?? new JArray()).OfType<JObject>()
            .Select(value => (string)value["name"] + ": " + (string)value["valueType"]?["kind"]).ToArray();
        var outputs = (definition["outputs"] as JArray ?? new JArray()).OfType<JObject>()
            .Select(value => (string)value["name"] + ": " + (string)value["valueType"]?["kind"]).ToArray();
        var inputText = parameters.Length == 0 ? "no parameters" : string.Join(", ", parameters);
        return outputs.Length == 0 ? inputText : inputText + " → " + string.Join(", ", outputs);
    }

    private static string MakeIdentifier(string value)
    {
        var result = new string((value ?? "Story").Select(character => char.IsLetterOrDigit(character) || character == '_' ? character : '_').ToArray());
        if (string.IsNullOrEmpty(result)) result = "Story";
        if (char.IsDigit(result[0])) result = "_" + result;
        return result;
    }

    internal static void NotifyImportCompleted(string message)
    {
        foreach (var window in Resources.FindObjectsOfTypeAll<UnityStoryImporterWindow>())
        {
            window._status = message;
            window.Repaint();
        }
    }
}

[InitializeOnLoad]
internal static class StoryBlueprintImportPanelStartup
{
    private const string OpenedThisSessionKey = "StoryBlueprint.Import.PanelOpenedThisSession";

    static StoryBlueprintImportPanelStartup()
    {
        if (SessionState.GetBool(OpenedThisSessionKey, false)) return;
        SessionState.SetBool(OpenedThisSessionKey, true);
        EditorApplication.delayCall += UnityStoryImporterWindow.Open;
    }
}

[InitializeOnLoad]
internal static class StoryBlueprintImportFinalizer
{
    private const string PendingClassKey = "StoryBlueprint.Import.PendingClass";
    private const string PendingJsonKey = "StoryBlueprint.Import.PendingJson";
    private const string PendingObjectNameKey = "StoryBlueprint.Import.PendingObjectName";
    private const string PendingPlayOnStartKey = "StoryBlueprint.Import.PendingPlayOnStart";
    private static double _nextPoll;

    static StoryBlueprintImportFinalizer()
    {
        BeginWatching();
    }

    internal static void BeginWatching()
    {
        if (!HasPendingImport()) return;
        EditorApplication.update -= Poll;
        EditorApplication.update += Poll;
        EditorApplication.delayCall += TryCreateHost;
    }

    private static void Poll()
    {
        if (EditorApplication.timeSinceStartup < _nextPoll) return;
        _nextPoll = EditorApplication.timeSinceStartup + 0.5d;
        if (!HasPendingImport())
        {
            EditorApplication.update -= Poll;
            return;
        }
        if (!EditorApplication.isCompiling && !EditorApplication.isUpdating) TryCreateHost();
    }

    private static bool HasPendingImport()
    {
        return EditorPrefs.HasKey(PendingClassKey) && EditorPrefs.HasKey(PendingJsonKey);
    }

    private static void TryCreateHost()
    {
        if (!HasPendingImport() || EditorApplication.isCompiling || EditorApplication.isUpdating) return;
        var className = EditorPrefs.GetString(PendingClassKey);
        var type = AppDomain.CurrentDomain.GetAssemblies()
            .Select(assembly => assembly.GetType(className, false))
            .FirstOrDefault(candidate => candidate != null);
        if (type == null) return;
        if (!typeof(UnityStoryHost).IsAssignableFrom(type))
        {
            Debug.LogError("Generated type does not inherit UnityStoryHost: " + className);
            ClearPending();
            return;
        }

        var assetPath = EditorPrefs.GetString(PendingJsonKey);
        var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(assetPath);
        if (asset == null)
        {
            Debug.LogError("Imported Story Blueprint JSON asset was not found: " + assetPath);
            ClearPending();
            return;
        }

        try
        {
            var playerPrefab = FindStoryPlayerPrefab();
            if (playerPrefab == null)
                throw new InvalidOperationException("The generic Story Player prefab is missing. Include StoryBlueprintStoryPlayer.prefab from the package's Runtime/Demo folder when exporting, then import it into the project.");

            var gameObject = PrefabUtility.InstantiatePrefab(playerPrefab, EditorSceneManager.GetActiveScene()) as GameObject;
            if (gameObject == null) throw new InvalidOperationException("Could not add the Story Player prefab to the current scene.");
            gameObject.name = EditorPrefs.GetString(PendingObjectNameKey, "Story Blueprint Host");
            Undo.RegisterCreatedObjectUndo(gameObject, "Create Story Blueprint Host");
            var host = Undo.AddComponent(gameObject, type);
            var serializedHost = new SerializedObject(host);
            serializedHost.FindProperty("compiledProject").objectReferenceValue = asset;
            serializedHost.FindProperty("streamingAssetsPath").stringValue = string.Empty;
            serializedHost.FindProperty("entryStoryId").stringValue = string.Empty;
            serializedHost.FindProperty("playOnStart").boolValue = EditorPrefs.GetBool(PendingPlayOnStartKey, true);
            serializedHost.ApplyModifiedPropertiesWithoutUndo();
            EditorSceneManager.MarkSceneDirty(gameObject.scene);
            Selection.activeGameObject = gameObject;
            EditorGUIUtility.PingObject(gameObject);
            Debug.Log("Imported Story Blueprint and created " + type.Name + " on GameObject '" + gameObject.name + "'. Implement its generated External Function methods in the selected script asset.");
            UnityStoryImporterWindow.NotifyImportCompleted("Host GameObject added to the current scene. Implement External Function methods in the generated script.");
            ClearPending();
        }
        catch (Exception exception)
        {
            Debug.LogException(exception);
            UnityStoryImporterWindow.NotifyImportCompleted("Unity could not finish creating the Host. See the Console for details.");
            ClearPending();
        }
    }

    private static GameObject FindStoryPlayerPrefab()
    {
        var packagePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(StoryPlayerPrefabBuilder.PrefabPath);
        if (IsStoryPlayerPrefab(packagePrefab)) return packagePrefab;

        // The adapter may be imported under any Assets folder name, so locate the prefab by asset identity/name.
        var guids = AssetDatabase.FindAssets("StoryBlueprintStoryPlayer t:Prefab");
        foreach (var guid in guids)
        {
            var path = AssetDatabase.GUIDToAssetPath(guid);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (IsStoryPlayerPrefab(prefab)) return prefab;
        }
        return null;
    }

    private static bool IsStoryPlayerPrefab(GameObject prefab)
    {
        return prefab != null && prefab.GetComponent<StoryPlayerPresenter>() != null &&
               prefab.GetComponent<UnityStoryHost>() == null;
    }

    private static void ClearPending()
    {
        EditorPrefs.DeleteKey(PendingClassKey);
        EditorPrefs.DeleteKey(PendingJsonKey);
        EditorPrefs.DeleteKey(PendingObjectNameKey);
        EditorPrefs.DeleteKey(PendingPlayOnStartKey);
        EditorApplication.update -= Poll;
    }
}
