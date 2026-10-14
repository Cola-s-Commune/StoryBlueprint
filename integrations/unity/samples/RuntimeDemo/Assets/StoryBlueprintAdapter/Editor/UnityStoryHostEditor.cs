using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;
using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(UnityStoryHost), true)]
public sealed class UnityStoryHostEditor : Editor
{
    private static readonly HashSet<string> CSharpKeywords = new HashSet<string>(StringComparer.Ordinal)
    {
        "abstract", "as", "base", "bool", "break", "byte", "case", "catch", "char", "checked",
        "class", "const", "continue", "decimal", "default", "delegate", "do", "double", "else",
        "enum", "event", "explicit", "extern", "false", "finally", "fixed", "float", "for",
        "foreach", "goto", "if", "implicit", "in", "int", "interface", "internal", "is", "lock",
        "long", "namespace", "new", "null", "object", "operator", "out", "override", "params",
        "private", "protected", "public", "readonly", "ref", "return", "sbyte", "sealed", "short",
        "sizeof", "stackalloc", "static", "string", "struct", "switch", "this", "throw", "true",
        "try", "typeof", "uint", "ulong", "unchecked", "unsafe", "ushort", "using", "virtual",
        "void", "volatile", "while"
    };

    private bool _showManualBindings;
    private bool _showFunctions;
    private bool _showSignals;
    private string _manifestError;

    public override void OnInspectorGUI()
    {
        serializedObject.Update();
        DrawPropertiesExcluding(serializedObject, "m_Script", "externalFunctionBindings", "signalBindings");
        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Story Blueprint", EditorStyles.boldLabel);
        if (GUILayout.Button("Open Story Import Panel")) UnityStoryImporterWindow.Open();

        var compiledProperty = serializedObject.FindProperty("compiledProject");
        var projectAsset = compiledProperty == null ? null : compiledProperty.objectReferenceValue as TextAsset;
        if (IsGeneratedHost())
        {
            EditorGUILayout.HelpBox("External Functions and Signals are handled in this generated Host script.", MessageType.Info);
            if (GUILayout.Button("Open Generated C#")) OpenHostScript();
            serializedObject.ApplyModifiedProperties();
            return;
        }

        using (new EditorGUI.DisabledScope(projectAsset == null))
        {
            if (GUILayout.Button("Generate C# Host")) GenerateHost(projectAsset);
        }

        _showManualBindings = EditorGUILayout.Foldout(_showManualBindings, "Advanced Manual Component Bindings", true);
        if (_showManualBindings)
        {
            EditorGUILayout.HelpBox("Use this only when game components implement the binding interfaces directly instead of using a generated C# Host.", MessageType.Info);
            using (new EditorGUI.DisabledScope(projectAsset == null))
            {
                if (GUILayout.Button("Refresh Manual Bindings")) RefreshManifest(projectAsset);
            }
            if (!string.IsNullOrEmpty(_manifestError)) EditorGUILayout.HelpBox(_manifestError, MessageType.Error);

            if (projectAsset != null && TryReadManifest(projectAsset, out var functions, out var signals, out var error))
            {
                _manifestError = null;
                DrawFunctions(functions);
                DrawSignals(signals);
            }
            else if (projectAsset == null)
            {
                EditorGUILayout.HelpBox("Assign a compiled project or standalone story TextAsset to configure manual bindings.", MessageType.None);
            }
            else if (string.IsNullOrEmpty(_manifestError))
            {
                TryReadManifest(projectAsset, out _, out _, out error);
                _manifestError = error;
                EditorGUILayout.HelpBox(_manifestError, MessageType.Error);
            }
        }

        serializedObject.ApplyModifiedProperties();
    }

    private bool IsGeneratedHost()
    {
        var type = target.GetType();
        return Attribute.IsDefined(type, typeof(GeneratedStoryHostAttribute), false) ||
               type.Name.StartsWith("StoryBlueprintGenerated_", StringComparison.Ordinal);
    }

    private void OpenHostScript()
    {
        var script = MonoScript.FromMonoBehaviour((MonoBehaviour)target);
        if (script == null) return;
        AssetDatabase.OpenAsset(script);
        EditorGUIUtility.PingObject(script);
    }

    private void RefreshManifest(TextAsset asset)
    {
        if (!TryReadManifest(asset, out var functions, out var signals, out var error))
        {
            _manifestError = error;
            return;
        }

        SyncEntries("externalFunctionBindings", "functionId", "handler", functions);
        SyncEntries("signalBindings", "signalId", "source", signals);
        _manifestError = null;
        serializedObject.ApplyModifiedProperties();
    }

    private void GenerateHost(TextAsset asset)
    {
        if (!TryReadManifest(asset, out var functions, out var signals, out var error))
        {
            _manifestError = error;
            return;
        }

        var suggestedName = "StoryBlueprintGenerated_" + MakeIdentifier(asset.name);
        var selectedPath = EditorUtility.SaveFilePanelInProject("Generate Story Blueprint Host", suggestedName,
            "cs", "Choose where to create the generated host script.");
        if (string.IsNullOrEmpty(selectedPath)) return;

        var folder = Path.GetDirectoryName(selectedPath).Replace('\\', '/');
        var className = MakeIdentifier(Path.GetFileNameWithoutExtension(selectedPath));
        var outputPath = folder + "/" + className + ".cs";
        if (File.Exists(outputPath) && !EditorUtility.DisplayDialog("Replace generated host?",
                "A generated host already exists at this path. Replace it with the bindings from the selected story?",
                "Replace", "Cancel")) return;
        File.WriteAllText(outputPath, BuildHostSource(className, functions, signals), new UTF8Encoding(false));
        AssetDatabase.Refresh();
        var script = AssetDatabase.LoadAssetAtPath<MonoScript>(outputPath);
        Selection.activeObject = script;
        EditorGUIUtility.PingObject(script);
        _manifestError = null;
    }

    internal static string BuildHostSource(string className, JArray functions, JArray signals)
    {
        var source = new StringBuilder();
        source.AppendLine("using System;");
        source.AppendLine("using System.Threading;");
        source.AppendLine("using System.Threading.Tasks;");
        source.AppendLine("using UnityEngine;");
        source.AppendLine("using Newtonsoft.Json.Linq;");
        source.AppendLine("using StoryBlueprint.Runtime;");
        source.AppendLine("using StoryBlueprint.Unity;");
        source.AppendLine();
        source.AppendLine("// Generated from a Story Blueprint story JSON. Fill in each External Function handler.");
        source.AppendLine("[GeneratedStoryHost]");
        source.AppendLine("public sealed class " + className + " : UnityStoryHost");
        source.AppendLine("{");
        var functionDefinitions = functions.OfType<JObject>().ToArray();
        var functionMethodNames = new List<string>(functionDefinitions.Length);
        var functionIdNames = new List<string>(functionDefinitions.Length);
        var usedFunctionNames = new HashSet<string>(StringComparer.Ordinal);
        var usedFunctionIdNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var function in functionDefinitions)
        {
            var name = DefinitionName(function);
            functionMethodNames.Add(UniqueIdentifier("Handle_" + MakeIdentifier(name), usedFunctionNames));
            functionIdNames.Add(UniqueIdentifier("ExternalFunctionId_" + MakeIdentifier(name), usedFunctionIdNames));
        }
        var functionOutputNames = new List<string[]>(functionDefinitions.Length);
        foreach (var function in functionDefinitions)
        {
            var usedOutputNames = new HashSet<string>(StringComparer.Ordinal);
            functionOutputNames.Add((function["outputs"] as JArray ?? new JArray()).OfType<JObject>()
                .Select((output, index) => UniqueIdentifier("return_" + MakeIdentifier((string)output["name"] ?? "Output" + index), usedOutputNames))
                .ToArray());
        }
        var functionOutputIdNames = new List<string[]>(functionDefinitions.Length);
        var usedOutputIdNames = new HashSet<string>(StringComparer.Ordinal);
        for (var functionIndex = 0; functionIndex < functionDefinitions.Length; functionIndex++)
        {
            var outputs = (functionDefinitions[functionIndex]["outputs"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            functionOutputIdNames.Add(outputs.Select((output, outputIndex) => UniqueIdentifier(
                "ExternalFunctionOutputId_" + functionMethodNames[functionIndex] + "_" + MakeIdentifier((string)output["name"] ?? "Output" + outputIndex),
                usedOutputIdNames)).ToArray());
        }

        var signalDefinitions = signals.OfType<JObject>().ToArray();
        var signalMethodNames = new List<string>(signalDefinitions.Length);
        var signalIdNames = new List<string>(signalDefinitions.Length);
        var usedSignalNames = new HashSet<string>(StringComparer.Ordinal);
        var usedSignalIdNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var signal in signalDefinitions)
        {
            var name = DefinitionName(signal);
            signalMethodNames.Add(UniqueIdentifier("SendSignal_" + MakeIdentifier(name), usedSignalNames));
            signalIdNames.Add(UniqueIdentifier("SignalId_" + MakeIdentifier(name), usedSignalIdNames));
        }

        for (var functionIndex = 0; functionIndex < functionDefinitions.Length; functionIndex++)
            source.AppendLine("    private const string " + functionIdNames[functionIndex] + " = " + CSharpString((string)functionDefinitions[functionIndex]["id"]) + ";");
        for (var functionIndex = 0; functionIndex < functionDefinitions.Length; functionIndex++)
        {
            var outputs = (functionDefinitions[functionIndex]["outputs"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            for (var outputIndex = 0; outputIndex < outputs.Length; outputIndex++)
                source.AppendLine("    private const string " + functionOutputIdNames[functionIndex][outputIndex] + " = " + CSharpString((string)outputs[outputIndex]["id"]) + ";");
        }
        for (var signalIndex = 0; signalIndex < signalDefinitions.Length; signalIndex++)
            source.AppendLine("    private const string " + signalIdNames[signalIndex] + " = " + CSharpString((string)signalDefinitions[signalIndex]["id"]) + ";");

        if (functionDefinitions.Length > 0) source.AppendLine();
        source.AppendLine("    private static JToken ToToken(object value)");
        source.AppendLine("    {");
        source.AppendLine("        if (value == null) return JValue.CreateNull();");
        source.AppendLine("        var token = value as JToken;");
        source.AppendLine("        return token == null ? JToken.FromObject(value) : token.DeepClone();");
        source.AppendLine("    }");

        source.AppendLine();
        source.AppendLine("    protected override void ConfigureAdapter(UnityStoryAdapter adapter)");
        source.AppendLine("    {");
        source.AppendLine("        base.ConfigureAdapter(adapter);");
        for (var functionIndex = 0; functionIndex < functionDefinitions.Length; functionIndex++)
        {
            var function = functionDefinitions[functionIndex];
            var parameters = (function["parameters"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            var arguments = string.Join(", ", parameters.Select(ReadArgumentExpression));
            if (!string.IsNullOrEmpty(arguments)) arguments += ", ";
            arguments += "cancellationToken";
            var outputs = (function["outputs"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            source.AppendLine("        adapter.RegisterExternalFunction(" + functionIdNames[functionIndex] + ", async (request, cancellationToken) =>");
            source.AppendLine("        {");
            if (outputs.Length == 0)
            {
                source.AppendLine("            await " + functionMethodNames[functionIndex] + "(" + arguments + ");");
                source.AppendLine("            return new JObject();");
            }
            else
            {
                source.AppendLine("            var result = await " + functionMethodNames[functionIndex] + "(" + arguments + ");");
                if (outputs.Length > 1)
                    source.AppendLine("            if (result == null) throw new InvalidOperationException(" + CSharpString("External Function " + DefinitionName(function) + " returned a null result.") + ");");
                source.AppendLine("            return new JObject");
                source.AppendLine("            {");
                for (var outputIndex = 0; outputIndex < outputs.Length; outputIndex++)
                {
                    var outputValue = outputs.Length == 1 ? "result" : "result." + functionOutputNames[functionIndex][outputIndex];
                    source.AppendLine("                [" + functionOutputIdNames[functionIndex][outputIndex] + "] = ToToken(" + outputValue + ")" + (outputIndex + 1 == outputs.Length ? "" : ","));
                }
                source.AppendLine("            };" );
            }
            source.AppendLine("        });");
        }
        source.AppendLine("    }");

        for (var functionIndex = 0; functionIndex < functionDefinitions.Length; functionIndex++)
        {
            var function = functionDefinitions[functionIndex];
            var name = DefinitionName(function);
            var parameters = (function["parameters"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            var parameterNames = ParameterNames(parameters, "cancellationToken");
            var outputs = (function["outputs"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            var resultType = ResultTypeName(functionMethodNames[functionIndex]);
            var returnType = outputs.Length == 0 ? "" : "<" + (outputs.Length == 1 ? CSharpType((string)outputs[0]["valueType"]?["kind"]) : resultType) + ">";
            var signatureParameters = parameters.Select((parameter, index) => CSharpType((string)parameter["valueType"]?["kind"]) + " " + parameterNames[index]).ToList();
            signatureParameters.Add("CancellationToken cancellationToken");
            source.AppendLine();
            if (outputs.Length > 1)
            {
                source.AppendLine("    private sealed class " + resultType);
                source.AppendLine("    {");
                for (var outputIndex = 0; outputIndex < outputs.Length; outputIndex++)
                {
                    var propertyName = functionOutputNames[functionIndex][outputIndex];
                    source.AppendLine("        public " + CSharpType((string)outputs[outputIndex]["valueType"]?["kind"]) + " " + propertyName + " { get; set; }");
                }
                source.AppendLine("    }");
                source.AppendLine();
            }
            source.AppendLine("    private Task" + returnType + " " + functionMethodNames[functionIndex] + "(" + string.Join(", ", signatureParameters) + ")");
            source.AppendLine("    {");
            source.AppendLine("        cancellationToken.ThrowIfCancellationRequested();");
            source.AppendLine("        // External Function: " + SafeComment(name));
            foreach (var parameter in parameters.Select((value, index) => new { Value = value, Name = parameterNames[index] }))
                source.AppendLine("        // Input: " + parameter.Name + " (" + SafeComment(CSharpType((string)parameter.Value["valueType"]?["kind"])) + ")");
            for (var outputIndex = 0; outputIndex < outputs.Length; outputIndex++)
            {
                var output = outputs[outputIndex];
                var outputName = SafeComment((string)output["name"] ?? "Output " + (outputIndex + 1));
                var outputType = SafeComment(CSharpType((string)output["valueType"]?["kind"]));
                source.AppendLine(outputs.Length == 1
                    ? "        // Return: " + outputType + " for " + outputName + "."
                    : "        // Output: " + outputType + " " + functionOutputNames[functionIndex][outputIndex] + " for " + outputName + ".");
            }
            if (outputs.Length == 0)
            {
                source.AppendLine("        // TODO: Perform the game action.");
                source.AppendLine("        // Return with: return Task.CompletedTask;");
            }
            else if (outputs.Length == 1)
            {
                source.AppendLine("        // TODO: Perform the game action and return its typed value.");
                source.AppendLine("        // Example: return Task.FromResult(default(" + CSharpType((string)outputs[0]["valueType"]?["kind"]) + ")); // Replace default(...) with the real result.");
            }
            else
            {
                source.AppendLine("        // TODO: Return all output values.");
                source.AppendLine("        // Return with: return Task.FromResult(new " + resultType + "");
                source.AppendLine("        // {");
                for (var outputIndex = 0; outputIndex < outputs.Length; outputIndex++)
                    source.AppendLine("        //     " + functionOutputNames[functionIndex][outputIndex] + " = default(" + CSharpType((string)outputs[outputIndex]["valueType"]?["kind"]) + ")" + (outputIndex + 1 == outputs.Length ? "" : ","));
                source.AppendLine("        // });");
            }
            source.AppendLine("        throw new NotImplementedException(" + CSharpString("Implement External Function " + name) + ");");
            source.AppendLine("    }");
        }

        for (var signalIndex = 0; signalIndex < signalDefinitions.Length; signalIndex++)
        {
            var signal = signalDefinitions[signalIndex];
            var name = DefinitionName(signal);
            var parameters = (signal["parameters"] as JArray ?? new JArray()).OfType<JObject>().ToArray();
            var parameterNames = ParameterNames(parameters, "payload");
            var signature = string.Join(", ", parameters.Select((parameter, index) => CSharpType((string)parameter["valueType"]?["kind"]) + " " + parameterNames[index]));
            source.AppendLine();
            source.AppendLine("    // Call this when the game observes Signal " + SafeComment(name) + ".");
            source.AppendLine("    public void " + signalMethodNames[signalIndex] + "(" + signature + ")");
            source.AppendLine("    {");
            source.AppendLine("        var payload = new JObject();");
            foreach (var parameter in parameters.Select((value, index) => new { Value = value, Name = parameterNames[index] }))
            {
                var parameterName = (string)parameter.Value["name"];
                var kind = (string)parameter.Value["valueType"]?["kind"];
                var token = CSharpType(kind) == "JToken"
                    ? parameter.Name + " ?? JValue.CreateNull()"
                    : "JToken.FromObject(" + parameter.Name + ")";
                source.AppendLine("        payload[" + CSharpString(parameterName) + "] = " + token + ";");
            }
            source.AppendLine("        SendSignal(" + signalIdNames[signalIndex] + ", payload);");
            source.AppendLine("    }");
        }
        source.AppendLine("}");
        return source.ToString();
    }

    private static string DefinitionName(JObject definition)
    {
        return (string)definition["name"] ?? (string)definition["displayName"] ?? (string)definition["id"] ?? "Binding";
    }

    private static string[] ParameterNames(JObject[] parameters, params string[] reservedNames)
    {
        var used = new HashSet<string>(reservedNames ?? new string[0], StringComparer.Ordinal);
        return parameters.Select(parameter => UniqueIdentifier(ParameterIdentifier((string)parameter["name"]), used)).ToArray();
    }

    private static string ParameterIdentifier(string value)
    {
        var identifier = MakeIdentifier(value);
        return CSharpKeywords.Contains(identifier) ? "@" + identifier : identifier;
    }

    private static string ReadArgumentExpression(JObject parameter)
    {
        var name = (string)parameter["name"] ?? "";
        var kind = (string)parameter["valueType"]?["kind"];
        var type = CSharpType(kind);
        var value = type == "JToken"
            ? "(request.Arguments[" + CSharpString(name) + "] ?? JValue.CreateNull()).DeepClone()"
            : "request.Arguments.Value<" + type + ">(" + CSharpString(name) + ")";
        return value;
    }

    private static string ResultTypeName(string methodName)
    {
        return "ExternalFunctionResult_" + methodName;
    }

    private static string CSharpType(string kind)
    {
        switch (kind)
        {
            case "string": return "string";
            case "number": return "double";
            case "boolean": return "bool";
            default: return "JToken";
        }
    }

    private static string MakeIdentifier(string value)
    {
        var result = new string((value ?? "Binding").Select(character => char.IsLetterOrDigit(character) || character == '_' ? character : '_').ToArray());
        if (string.IsNullOrEmpty(result)) result = "Binding";
        if (char.IsDigit(result[0])) result = "_" + result;
        return result;
    }

    private static string UniqueIdentifier(string value, HashSet<string> used)
    {
        var result = value;
        var suffix = 2;
        while (!used.Add(result)) result = value + "_" + suffix++;
        return result;
    }

    private static string CSharpString(string value)
    {
        var escaped = new StringBuilder();
        foreach (var character in value ?? "")
        {
            switch (character)
            {
                case '\\': escaped.Append("\\\\"); break;
                case '"': escaped.Append("\\\""); break;
                case '\0': escaped.Append("\\0"); break;
                case '\a': escaped.Append("\\a"); break;
                case '\b': escaped.Append("\\b"); break;
                case '\f': escaped.Append("\\f"); break;
                case '\n': escaped.Append("\\n"); break;
                case '\r': escaped.Append("\\r"); break;
                case '\t': escaped.Append("\\t"); break;
                case '\v': escaped.Append("\\v"); break;
                default:
                    if (char.IsControl(character)) escaped.Append("\\u" + ((int)character).ToString("x4"));
                    else escaped.Append(character);
                    break;
            }
        }
        return "\"" + escaped + "\"";
    }

    private static string SafeComment(string value)
    {
        return (value ?? "").Replace("\r", " ").Replace("\n", " ").Replace("*/", "* /");
    }

    private void SyncEntries(string listName, string idName, string componentName, JArray manifest)
    {
        var list = serializedObject.FindProperty(listName);
        var existing = new Dictionary<string, UnityEngine.Object>(StringComparer.Ordinal);
        for (var i = 0; i < list.arraySize; i++)
        {
            var element = list.GetArrayElementAtIndex(i);
            existing[element.FindPropertyRelative(idName).stringValue] = element.FindPropertyRelative(componentName).objectReferenceValue;
        }

        list.ClearArray();
        if (manifest == null) return;
        foreach (var definition in manifest.OfType<JObject>())
        {
            var id = (string)definition["id"];
            if (string.IsNullOrWhiteSpace(id)) continue;
            var index = list.arraySize++;
            var element = list.GetArrayElementAtIndex(index);
            element.FindPropertyRelative(idName).stringValue = id;
            existing.TryGetValue(id, out var component);
            element.FindPropertyRelative(componentName).objectReferenceValue = component;
        }
    }

    private void DrawFunctions(JArray definitions)
    {
        var list = serializedObject.FindProperty("externalFunctionBindings");
        _showFunctions = EditorGUILayout.Foldout(_showFunctions, "External Functions (" + definitions.Count + ")", true, EditorStyles.foldoutHeader);
        if (!_showFunctions) return;
        if (definitions.Count == 0) EditorGUILayout.HelpBox("This project declares no External Functions.", MessageType.None);
        foreach (var definition in definitions.OfType<JObject>())
        {
            var id = (string)definition["id"];
            var row = FindBinding(list, "functionId", id);
            DrawBindingRow(row, "handler", (string)definition["displayName"] ?? (string)definition["name"] ?? id,
                id, ParametersAndOutputs(definition), "Function Handler", typeof(IUnityStoryExternalFunctionHandler));
        }
    }

    private void DrawSignals(JArray definitions)
    {
        var list = serializedObject.FindProperty("signalBindings");
        _showSignals = EditorGUILayout.Foldout(_showSignals, "Signals (" + definitions.Count + ")", true, EditorStyles.foldoutHeader);
        if (!_showSignals) return;
        if (definitions.Count == 0) EditorGUILayout.HelpBox("This project declares no Signals.", MessageType.None);
        foreach (var definition in definitions.OfType<JObject>())
        {
            var id = (string)definition["id"];
            var row = FindBinding(list, "signalId", id);
            DrawBindingRow(row, "source", (string)definition["displayName"] ?? (string)definition["name"] ?? id,
                id, ParametersAndOutputs(definition), "Signal Source", typeof(IUnityStorySignalSource));
        }
    }

    private static SerializedProperty FindBinding(SerializedProperty list, string idName, string id)
    {
        for (var i = 0; i < list.arraySize; i++)
        {
            var item = list.GetArrayElementAtIndex(i);
            if (item.FindPropertyRelative(idName).stringValue == id) return item;
        }
        return null;
    }

    private static void DrawBindingRow(SerializedProperty row, string componentName, string title,
        string id, string details, string componentLabel, Type requiredInterface)
    {
        EditorGUILayout.BeginVertical(EditorStyles.helpBox);
        EditorGUILayout.LabelField(title, EditorStyles.boldLabel);
        EditorGUILayout.LabelField(id, EditorStyles.miniLabel);
        if (!string.IsNullOrEmpty(details)) EditorGUILayout.LabelField(details, EditorStyles.wordWrappedMiniLabel);
        if (row == null)
        {
            EditorGUILayout.HelpBox("Binding list is out of date. Click Refresh Bindings.", MessageType.Warning);
        }
        else
        {
            var field = row.FindPropertyRelative(componentName);
            EditorGUI.BeginChangeCheck();
            var value = (MonoBehaviour)EditorGUILayout.ObjectField(componentLabel, field.objectReferenceValue, typeof(MonoBehaviour), true);
            if (EditorGUI.EndChangeCheck()) field.objectReferenceValue = value;
            if (value != null && !requiredInterface.IsInstanceOfType(value))
                EditorGUILayout.HelpBox("Component must implement " + requiredInterface.Name + ".", MessageType.Error);
        }
        EditorGUILayout.EndVertical();
    }

    private static string ParametersAndOutputs(JObject definition)
    {
        var parameters = (definition["parameters"] as JArray ?? new JArray())
            .OfType<JObject>().Select(item => (string)item["name"] + ": " + (string)item["valueType"]?["kind"]);
        var outputs = (definition["outputs"] as JArray ?? new JArray())
            .OfType<JObject>().Select(item => (string)item["name"] + " → " + (string)item["valueType"]?["kind"]);
        return "Inputs: " + (parameters.Any() ? string.Join(", ", parameters) : "none") +
               "\nOutputs: " + (outputs.Any() ? string.Join(", ", outputs) : "none");
    }

    private static bool TryReadManifest(TextAsset asset, out JArray functions, out JArray signals, out string error)
    {
        try
        {
            var project = StoryProject.Parse(asset.text);
            if (project.Data["format"]?.ToString() == "story-blueprint-compiled-project")
            {
                functions = project.Data["events"] as JArray ?? new JArray();
                signals = project.Data["signals"] as JArray ?? new JArray();
            }
            else
                DeriveStandaloneBindings(project, out functions, out signals);
            error = null;
            return true;
        }
        catch (Exception exception)
        {
            functions = null;
            signals = null;
            error = exception.Message;
            return false;
        }
    }

    private static void DeriveStandaloneBindings(StoryProject project, out JArray functions, out JArray signals)
    {
        var functionMap = new Dictionary<string, JObject>(StringComparer.Ordinal);
        var signalMap = new Dictionary<string, JObject>(StringComparer.Ordinal);
        foreach (var program in project.Programs.Values)
        foreach (var block in (JObject)program.Data["blocks"])
        foreach (var instruction in ((JArray)block.Value["instructions"]).OfType<JObject>())
        {
            var operation = (string)instruction["op"];
            if (operation == "call-event")
            {
                var id = (string)instruction["eventId"];
                if (!functionMap.TryGetValue(id, out var function))
                {
                    function = new JObject { ["id"] = id, ["name"] = id, ["displayName"] = id,
                        ["parameters"] = new JArray(), ["outputs"] = new JArray() };
                    functionMap.Add(id, function);
                }
                var knownParameters = new HashSet<string>(((JArray)function["parameters"]).OfType<JObject>().Select(item => (string)item["name"]), StringComparer.Ordinal);
                foreach (var argument in ((JObject)instruction["arguments"]).Properties())
                    if (knownParameters.Add(argument.Name))
                        ((JArray)function["parameters"]).Add(new JObject { ["name"] = argument.Name,
                            ["valueType"] = argument.Value["valueType"]?.DeepClone() ?? new JObject { ["kind"] = "unknown" } });
                foreach (var output in ((JArray)instruction["outputs"]).OfType<JObject>())
                    if (!((JArray)function["outputs"]).OfType<JObject>().Any(item => (string)item["id"] == (string)output["id"]))
                        ((JArray)function["outputs"]).Add(output.DeepClone());
            }
            else if (operation == "wait-signal")
            {
                var id = (string)instruction["signalId"];
                if (!signalMap.TryGetValue(id, out var signal))
                {
                    signal = new JObject { ["id"] = id, ["name"] = id, ["displayName"] = id, ["parameters"] = new JArray() };
                    signalMap.Add(id, signal);
                }
                var knownParameters = new HashSet<string>(((JArray)signal["parameters"]).OfType<JObject>().Select(item => (string)item["name"]), StringComparer.Ordinal);
                foreach (var match in ((JObject)instruction["matches"]).Properties())
                    if (knownParameters.Add(match.Name))
                        ((JArray)signal["parameters"]).Add(new JObject { ["name"] = match.Name,
                            ["valueType"] = match.Value["valueType"]?.DeepClone() ?? new JObject { ["kind"] = "unknown" } });
            }
        }
        functions = new JArray(functionMap.Values);
        signals = new JArray(signalMap.Values);
    }
}
