using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace StoryBlueprint.Runtime
{
    /// <summary>A validated, node-free version 7 runtime program.</summary>
    public sealed class StoryProgram
    {
        public JObject Data { get; private set; }
        public string Id { get { return (string)Data["id"]; } }
        public string ContentVersion { get { return (string)Data["contentVersion"]; } }
        public string EntryBlockId { get { return (string)Data["entryBlockId"]; } }

        internal StoryProgram(JObject data, string path = "$", string storyId = null)
        {
            new ProgramValidator(data, path, storyId).Validate();
            Data = (JObject)data.DeepClone();
        }

        public static StoryProgram Parse(string json) { return new StoryProgram(ReadObject(json)); }

        public static StoryProgram ParseProject(string json, string storyId = null)
        {
            StoryProject project = StoryProject.Parse(json);
            string selected = storyId ?? project.EntryStoryId;
            StoryProgram result;
            if (!project.Programs.TryGetValue(selected, out result))
                throw new StoryRuntimeException("MISSING_STORY", "Story does not exist: " + selected, "$.stories", selected);
            return result;
        }

        internal static JObject ReadObject(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) throw new StoryRuntimeException("INVALID_JSON", "Story JSON is empty", "$");
            try
            {
                using (var text = new StringReader(json))
                using (var reader = new JsonTextReader(text) { DateParseHandling = DateParseHandling.None, FloatParseHandling = FloatParseHandling.Double })
                {
                    JToken token = JToken.ReadFrom(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
                    if (!(token is JObject result)) throw new StoryRuntimeException("INVALID_JSON", "Story JSON root must be an object", "$");
                    if (reader.Read()) throw new StoryRuntimeException("INVALID_JSON", "Unexpected content after JSON root", "$");
                    return result;
                }
            }
            catch (JsonException exception)
            {
                string path = exception is JsonReaderException parseError ? parseError.Path : "$";
                throw new StoryRuntimeException("INVALID_JSON", exception.Message, string.IsNullOrEmpty(path) ? "$" : "$." + path);
            }
        }
    }

    /// <summary>Loads either a standalone program or the version 1 compiled project envelope.</summary>
    public sealed class StoryProject
    {
        public JObject Data { get; private set; }
        public Dictionary<string, StoryProgram> Programs { get; private set; }
        public string EntryStoryId { get; private set; }

        private StoryProject(JObject data, Dictionary<string, StoryProgram> programs, string entryStoryId)
        {
            Data = (JObject)data.DeepClone();
            Programs = programs;
            EntryStoryId = entryStoryId;
        }

        public static StoryProject Parse(string json)
        {
            JObject root = StoryProgram.ReadObject(json);
            var programs = new Dictionary<string, StoryProgram>(StringComparer.Ordinal);
            if (root["format"]?.Type == JTokenType.String && (string)root["format"] == "story-runtime")
            {
                var program = new StoryProgram(root);
                programs.Add(program.Id, program);
                return new StoryProject(root, programs, program.Id);
            }
            if (root["format"]?.Type != JTokenType.String || (string)root["format"] != "story-blueprint-compiled-project")
                throw new StoryRuntimeException("INVALID_PROJECT", "Unsupported Story Blueprint artifact format", "$.format");
            if (root["version"]?.Type != JTokenType.Integer || root["version"].ToString() != "1")
                throw new StoryRuntimeException("UNSUPPORTED_PROJECT_VERSION", "Only compiled project version 1 is supported", "$.version");
            string entry = RequiredString(root, "entryStoryId", "$");
            RequiredString(root, "projectId", "$");
            RequiredString(root, "contentVersion", "$");
            RequiredText(root, "name", "$");
            RequiredText(root, "displayName", "$");
            JObject stories = root["stories"] as JObject;
            if (stories == null) throw new StoryRuntimeException("INVALID_PROJECT", "stories must be an object", "$.stories");
            foreach (JProperty property in stories.Properties())
            {
                string path = "$.stories." + property.Name;
                JObject story = property.Value as JObject;
                if (story == null) throw new StoryRuntimeException("INVALID_PROJECT", "Story entry must be an object", path, property.Name);
                if (RequiredString(story, "storyId", path) != property.Name)
                    throw new StoryRuntimeException("INVALID_PROJECT", "Story key does not match storyId", path + ".storyId", property.Name);
                RequiredText(story, "name", path);
                RequiredText(story, "displayName", path);
                if (!(story["program"] is JObject program)) throw new StoryRuntimeException("INVALID_PROJECT", "Story program must be an object", path + ".program", property.Name);
                programs.Add(property.Name, new StoryProgram(program, path + ".program", property.Name));
                ValidateResourceArray(story, "characters", path);
                ValidateResourceArray(story, "assets", path);
            }
            if (!programs.ContainsKey(entry)) throw new StoryRuntimeException("MISSING_STORY", "Entry story does not exist: " + entry, "$.entryStoryId", entry);
            ValidateResourceArray(root, "events", "$");
            ValidateResourceArray(root, "signals", "$");
            foreach (var pair in programs)
                ValidateProjectReferences(pair.Key, pair.Value, programs, root);
            return new StoryProject(root, programs, entry);
        }

        private static void ValidateProjectReferences(string storyId, StoryProgram program,
            Dictionary<string, StoryProgram> programs, JObject project)
        {
            var events = new HashSet<string>(((JArray)project["events"]).OfType<JObject>().Select(item => (string)item["id"]), StringComparer.Ordinal);
            var signals = new HashSet<string>(((JArray)project["signals"]).OfType<JObject>().Select(item => (string)item["id"]), StringComparer.Ordinal);
            var eventDefinitions = ((JArray)project["events"]).OfType<JObject>().ToDictionary(item => (string)item["id"], StringComparer.Ordinal);
            var signalDefinitions = ((JArray)project["signals"]).OfType<JObject>().ToDictionary(item => (string)item["id"], StringComparer.Ordinal);
            var instructionsById = new Dictionary<string, JObject>(StringComparer.Ordinal);
            foreach (JProperty block in ((JObject)program.Data["blocks"]).Properties())
            {
                var instructions = (JArray)block.Value["instructions"];
                for (int index = 0; index < instructions.Count; index++)
                {
                    var instruction = (JObject)instructions[index];
                    instructionsById.Add((string)instruction["id"], instruction);
                    string op = (string)instruction["op"];
                    string path = "$.stories." + storyId + ".program.blocks." + block.Name + ".instructions[" + index + "]";
                    if ((op == "start-story" || op == "switch-story") && !programs.ContainsKey((string)instruction["storyId"]))
                        throw new StoryRuntimeException("MISSING_STORY", "Instruction references missing story " + instruction["storyId"], path + ".storyId", storyId, block.Name, (string)instruction["id"]);
                    if (op == "call-event" && !events.Contains((string)instruction["eventId"]))
                        throw new StoryRuntimeException("MISSING_EVENT", "Instruction references missing event " + instruction["eventId"], path + ".eventId", storyId, block.Name, (string)instruction["id"]);
                    if (op == "wait-signal" && !signals.Contains((string)instruction["signalId"]))
                        throw new StoryRuntimeException("MISSING_SIGNAL", "Instruction references missing signal " + instruction["signalId"], path + ".signalId", storyId, block.Name, (string)instruction["id"]);
                    if (op == "call-event")
                    {
                        JObject definition = eventDefinitions[(string)instruction["eventId"]];
                        ValidateParameters((JObject)instruction["arguments"], (JArray)definition["parameters"], path + ".arguments", true, storyId, block.Name, (string)instruction["id"]);
                        var outputs = ((JArray)definition["outputs"] ?? new JArray()).OfType<JObject>().ToDictionary(item => (string)item["id"], StringComparer.Ordinal);
                        if (((JArray)instruction["outputs"]).Count != outputs.Count)
                            throw new StoryRuntimeException("INVALID_OUTPUT", "Event outputs do not match the project manifest", path + ".outputs", storyId, block.Name, (string)instruction["id"]);
                        foreach (JObject output in (JArray)instruction["outputs"])
                        {
                            JObject declared;
                            if (!outputs.TryGetValue((string)output["id"], out declared) || !StoryEvaluator.DeepEquals(output["valueType"], declared["valueType"]))
                                throw new StoryRuntimeException("INVALID_OUTPUT", "Event output type or ID does not match the project manifest", path + ".outputs", storyId, block.Name, (string)instruction["id"]);
                        }
                    }
                    if (op == "wait-signal")
                        ValidateParameters((JObject)instruction["matches"], (JArray)signalDefinitions[(string)instruction["signalId"]]["parameters"], path + ".matches", false, storyId, block.Name, (string)instruction["id"]);
                }
            }
            foreach (JObject expression in program.Data.Descendants().OfType<JObject>().Where(item => item["kind"]?.Type == JTokenType.String && (string)item["kind"] == "signal-output"))
            {
                JObject producer = instructionsById[(string)expression["instructionId"]];
                JObject signal = signalDefinitions[(string)producer["signalId"]];
                JObject parameter = ((JArray)signal["parameters"]).OfType<JObject>().FirstOrDefault(item => (string)item["name"] == (string)expression["outputId"]);
                string path = "$.stories." + storyId + ".program." + expression.Path;
                if (parameter == null || !TypeKindsCompatible(expression["valueType"], parameter["valueType"]))
                    throw new StoryRuntimeException("INVALID_EXPRESSION", "Signal output name or type does not match the project manifest", path, storyId);
            }
        }

        private static void ValidateParameters(JObject arguments, JArray declarations, string path, bool requireAll,
            string storyId, string blockId, string instructionId)
        {
            var parameters = declarations.OfType<JObject>().ToDictionary(item => (string)item["name"], StringComparer.Ordinal);
            if (requireAll && parameters.Keys.Any(name => arguments.Property(name, StringComparison.Ordinal) == null))
                throw new StoryRuntimeException("INVALID_ARGUMENT", "Event is missing a required parameter", path, storyId, blockId, instructionId);
            foreach (JProperty argument in arguments.Properties())
            {
                JObject parameter;
                if (!parameters.TryGetValue(argument.Name, out parameter) || !TypeKindsCompatible(argument.Value["valueType"], parameter["valueType"]))
                    throw new StoryRuntimeException("INVALID_ARGUMENT", "Unknown parameter or mismatched type: " + argument.Name, path + "." + argument.Name, storyId, blockId, instructionId);
            }
        }
        private static bool TypeKindsCompatible(JToken first, JToken second)
        {
            string a = (string)first?["kind"];
            string b = (string)second?["kind"];
            return a == "any" || b == "any" || a == b;
        }

        private static string RequiredString(JObject value, string name, string path)
        {
            JToken token = value[name];
            if (token?.Type != JTokenType.String || string.IsNullOrWhiteSpace((string)token))
                throw new StoryRuntimeException("INVALID_PROJECT", name + " must be a nonempty string", path + "." + name);
            return (string)token;
        }
        private static void ValidateResourceArray(JObject value, string name, string path)
        {
            if (!(value[name] is JArray entries)) throw new StoryRuntimeException("INVALID_PROJECT", name + " must be an array", path + "." + name);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (int index = 0; index < entries.Count; index++)
            {
                string entryPath = path + "." + name + "[" + index + "]";
                if (!(entries[index] is JObject entry)) throw new StoryRuntimeException("INVALID_PROJECT", "Resource must be an object", entryPath);
                string id = RequiredString(entry, "id", entryPath);
                if (!ids.Add(id)) throw new StoryRuntimeException("DUPLICATE_ID", "Duplicate resource ID " + id, entryPath + ".id");
                RequiredText(entry, "name", entryPath);
                RequiredText(entry, "displayName", entryPath);
                if (name == "events" || name == "signals")
                {
                    ValidateInterfaceFields(entry["parameters"], "name", entryPath + ".parameters");
                    if (name == "events")
                    {
                        if (entry["resumable"]?.Type != JTokenType.Boolean)
                            throw new StoryRuntimeException("INVALID_PROJECT", "Event resumable must be a boolean", entryPath + ".resumable");
                        string effect = RequiredString(entry, "sideEffect", entryPath);
                        if (effect != "none" && effect != "read" && effect != "write")
                            throw new StoryRuntimeException("INVALID_PROJECT", "Unsupported Event sideEffect", entryPath + ".sideEffect");
                        if (entry["outputs"] != null) ValidateInterfaceFields(entry["outputs"], "id", entryPath + ".outputs");
                    }
                }
                if (name == "assets")
                {
                    string kind = RequiredString(entry, "kind", entryPath);
                    if (kind != "audio" && kind != "portrait" && kind != "other")
                        throw new StoryRuntimeException("INVALID_PROJECT", "Unsupported asset kind", entryPath + ".kind");
                    if (entry["locales"] != null && !(entry["locales"] is JObject))
                        throw new StoryRuntimeException("INVALID_PROJECT", "Asset locales must be an object", entryPath + ".locales");
                }
                if (name == "characters" && !(entry["emotions"] is JObject))
                    throw new StoryRuntimeException("INVALID_PROJECT", "Character emotions must be an object", entryPath + ".emotions");
            }
        }
        private static void RequiredText(JObject value, string name, string path)
        {
            if (value[name]?.Type != JTokenType.String) throw new StoryRuntimeException("INVALID_PROJECT", name + " must be a string", path + "." + name);
        }
        private static void ValidateInterfaceFields(JToken token, string idProperty, string path)
        {
            if (!(token is JArray fields)) throw new StoryRuntimeException("INVALID_PROJECT", "Interface fields must be an array", path);
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var names = new HashSet<string>(StringComparer.Ordinal);
            var validator = new ProgramValidator(new JObject(), "$", null);
            for (int index = 0; index < fields.Count; index++)
            {
                string fieldPath = path + "[" + index + "]";
                if (!(fields[index] is JObject field)) throw new StoryRuntimeException("INVALID_PROJECT", "Interface field must be an object", fieldPath);
                string id = RequiredString(field, idProperty, fieldPath);
                string name = RequiredString(field, "name", fieldPath);
                if (!ids.Add(id) || !names.Add(name)) throw new StoryRuntimeException("DUPLICATE_ID", "Duplicate interface field ID or name", fieldPath);
                validator.ValidateType(field["valueType"], fieldPath + ".valueType");
                if (idProperty == "id") RequiredText(field, "displayName", fieldPath);
            }
        }
    }

    internal sealed class ProgramValidator
    {
        private readonly JObject program;
        private readonly string rootPath;
        private readonly string storyId;
        private JObject blocks;
        private JObject chapters;
        private readonly Dictionary<string, JObject> variableTypes = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private readonly Dictionary<string, HashSet<string>> chapterBlockOwners = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        private readonly Dictionary<string, JObject> instructionsById = new Dictionary<string, JObject>(StringComparer.Ordinal);
        private string currentBlock;
        private string currentInstruction;
        private static readonly HashSet<string> Terminators = new HashSet<string>(new[] { "choice", "branch", "jump", "call-chapter", "return", "end-story" }, StringComparer.Ordinal);
        private static readonly HashSet<string> BinaryOperators = new HashSet<string>(new[] { "add", "subtract", "multiply", "divide", "modulo", "equal", "not-equal", "less-than", "less-than-or-equal", "greater-than", "greater-than-or-equal", "and", "or" }, StringComparer.Ordinal);

        internal ProgramValidator(JObject program, string path, string storyId)
        {
            this.program = program;
            rootPath = path;
            this.storyId = storyId;
        }

        internal void Validate()
        {
            if (program["format"]?.Type != JTokenType.String || (string)program["format"] != "story-runtime") Fail("INVALID_PROGRAM", "Expected story-runtime format", rootPath + ".format");
            if (program["version"]?.Type != JTokenType.Integer || program["version"].ToString() != "7")
                Fail("UNSUPPORTED_RUNTIME_VERSION", "Only story-runtime version 7 is supported", rootPath + ".version");
            foreach (JToken value in program.Descendants())
                if (value is JValue scalar && !StoryEvaluator.IsJsonValue(scalar))
                    Fail("INVALID_VALUE", "Runtime values must be finite JSON values", rootPath + "." + scalar.Path);
            String(program, "id", rootPath);
            String(program, "contentVersion", rootPath);
            string entry = String(program, "entryBlockId", rootPath);
            blocks = Object(program["blocks"], rootPath + ".blocks");
            chapters = Object(program["chapters"], rootPath + ".chapters");
            if (blocks[entry] == null) Fail("MISSING_ENTRY_BLOCK", "Entry block does not exist: " + entry, rootPath + ".entryBlockId");
            ValidateVariables(Array(program["variables"], rootPath + ".variables"), rootPath + ".variables", new HashSet<string>(StringComparer.Ordinal), "id");
            ValidateChapters();
            OptionalString(program, "sourceLocale", rootPath);
            if (program["locales"] != null) Strings(Array(program["locales"], rootPath + ".locales"), rootPath + ".locales");
            if (program["localeFallbacks"] != null)
            {
                JObject fallbacks = Object(program["localeFallbacks"], rootPath + ".localeFallbacks");
                foreach (JProperty property in fallbacks.Properties()) RequireString(property.Value, rootPath + ".localeFallbacks." + property.Name);
            }
            if (program["constants"] != null && !StoryEvaluator.IsJsonValue(Object(program["constants"], rootPath + ".constants")))
                Fail("INVALID_VALUE", "Constants must contain finite JSON values", rootPath + ".constants");
            // Collect IDs before inspecting expressions so forward output references can be validated.
            foreach (JProperty property in blocks.Properties())
            {
                currentBlock = property.Name;
                string path = rootPath + ".blocks." + property.Name;
                JObject block = Object(property.Value, path);
                if (String(block, "id", path) != property.Name) Fail("MISSING_BLOCK", "Block key does not match its ID", path + ".id");
                JArray instructions = Array(block["instructions"], path + ".instructions");
                for (int index = 0; index < instructions.Count; index++)
                {
                    string instructionPath = path + ".instructions[" + index + "]";
                    JObject instruction = Object(instructions[index], instructionPath);
                    currentInstruction = String(instruction, "id", instructionPath);
                    if (instructionsById.ContainsKey(currentInstruction)) Fail("DUPLICATE_ID", "Duplicate instruction ID " + currentInstruction, instructionPath + ".id");
                    instructionsById.Add(currentInstruction, instruction);
                }
            }
            FindChapterBlockOwners();
            foreach (JProperty property in blocks.Properties())
            {
                currentBlock = property.Name;
                string path = rootPath + ".blocks." + property.Name;
                JArray instructions = (JArray)property.Value["instructions"];
                if (instructions.Count == 0) Fail("EMPTY_BLOCK", "Block has no terminator", path + ".instructions");
                for (int index = 0; index < instructions.Count; index++)
                {
                    JObject instruction = (JObject)instructions[index];
                    currentInstruction = (string)instruction["id"];
                    string instructionPath = path + ".instructions[" + index + "]";
                    string op = String(instruction, "op", instructionPath);
                    if (Terminators.Contains(op) && index != instructions.Count - 1)
                        Fail("EARLY_TERMINATOR", "Terminator must be the final instruction in its block", instructionPath);
                    ValidateInstruction(instruction, op, instructionPath);
                }
                if (!Terminators.Contains((string)instructions.Last["op"]))
                    Fail("MISSING_TERMINATOR", "Block must end with explicit control flow", path + ".instructions");
            }
        }

        private void ValidateVariables(JArray variables, string path, HashSet<string> ids, string idProperty)
        {
            for (int index = 0; index < variables.Count; index++)
            {
                string variablePath = path + "[" + index + "]";
                JObject variable = Object(variables[index], variablePath);
                string id = String(variable, idProperty, variablePath);
                if (!ids.Add(id)) Fail("DUPLICATE_ID", "Duplicate variable ID " + id, variablePath + "." + idProperty);
                if (idProperty == "id")
                {
                    StringValue(variable["name"], variablePath + ".name");
                    StringValue(variable["displayName"], variablePath + ".displayName");
                    string scope = String(variable, "scope", variablePath);
                    if (scope != "project" && scope != "story" && scope != "chapter" && scope != "local" && scope != "character")
                        Fail("INVALID_PROGRAM", "Unsupported variable scope " + scope, variablePath + ".scope");
                }
                JObject type = ValidateType(variable["valueType"], variablePath + ".valueType");
                if (variable.Property("defaultValue", StringComparison.Ordinal) == null || !StoryEvaluator.MatchesType(variable["defaultValue"], type))
                    Fail("INVALID_VALUE", "Variable default value does not match its type", variablePath + ".defaultValue");
                variableTypes[id] = type;
            }
        }

        private void ValidateChapters()
        {
            foreach (JProperty property in chapters.Properties())
            {
                string path = rootPath + ".chapters." + property.Name;
                JObject chapter = Object(property.Value, path);
                if (String(chapter, "id", path) != property.Name) Fail("INVALID_CHAPTER", "Chapter key does not match its ID", path + ".id");
                Target(String(chapter, "entryBlockId", path), path + ".entryBlockId");
                var ids = new HashSet<string>(StringComparer.Ordinal);
                ValidateVariables(Array(chapter["parameters"], path + ".parameters"), path + ".parameters", ids, "variableId");
                JArray outputs = Array(chapter["outputs"], path + ".outputs");
                for (int index = 0; index < outputs.Count; index++)
                {
                    string outputPath = path + ".outputs[" + index + "]";
                    JObject output = Object(outputs[index], outputPath);
                    string id = String(output, "variableId", outputPath);
                    if (!ids.Add(id)) Fail("DUPLICATE_ID", "Duplicate chapter variable ID " + id, outputPath + ".variableId");
                    ValidateType(output["valueType"], outputPath + ".valueType");
                }
                ValidateVariables(Array(chapter["localVariables"], path + ".localVariables"), path + ".localVariables", ids, "id");
            }
        }

        private void ValidateInstruction(JObject instruction, string op, string path)
        {
            switch (op)
            {
                case "ink-block": Fail("UNSUPPORTED_INSTRUCTION", "Ink blocks are not supported by the native Unity runtime", path + ".op"); break;
                case "dialogue":
                    OptionalString(instruction, "speakerId", path);
                    OptionalExpression(instruction, "dynamicSpeaker", path);
                    OptionalString(instruction, "emotion", path);
                    OptionalString(instruction, "portraitId", path);
                    if (instruction["tags"] != null) Strings(Array(instruction["tags"], path + ".tags"), path + ".tags");
                    ValidateTemplate(instruction["text"], path + ".text");
                    ValidateVoice(instruction["voice"], path + ".voice");
                    break;
                case "narration":
                    ValidateTemplate(instruction["text"], path + ".text");
                    ValidateVoice(instruction["voice"], path + ".voice");
                    break;
                case "set-variable":
                {
                    JObject variableType = Variable(String(instruction, "variableId", path), path + ".variableId");
                    JObject value = ValidateExpression(instruction["value"], path + ".value");
                    string operation = OptionalString(instruction, "containerOperation", path);
                    string kind = (string)variableType["kind"];
                    if (operation == null) Compatible(value["valueType"] as JObject, variableType, path + ".value");
                    else if (operation == "append")
                    {
                        if (kind != "array") Fail("INVALID_INSTRUCTION", "append requires an Array variable", path + ".containerOperation");
                        if (variableType["elementType"] is JObject element) Compatible(value["valueType"] as JObject, element, path + ".value");
                    }
                    else if (operation == "set-entry")
                    {
                        if (kind != "map") Fail("INVALID_INSTRUCTION", "set-entry requires a Map variable", path + ".containerOperation");
                        JObject keyExpression = ValidateExpression(instruction["key"], path + ".key");
                        string keyKind = (string)keyExpression["valueType"]["kind"];
                        if (keyKind != "any" && keyKind != "number" && keyKind != "string" && keyKind != "enum" && keyKind != "asset-ref" && keyKind != "character-ref")
                            Fail("INVALID_INSTRUCTION", "Map key must be a String or Number", path + ".key");
                        JObject item = variableType["valueType"] as JObject;
                        if (item != null) Compatible(value["valueType"] as JObject, item, path + ".value");
                    }
                    else if (operation == "set-field")
                    {
                        if (kind != "struct" && kind != "json") Fail("INVALID_INSTRUCTION", "set-field requires a structured variable", path + ".containerOperation");
                        string field = String(instruction, "fieldName", path);
                        if (kind == "struct")
                        {
                            JObject fieldType = variableType["fields"]?[field] as JObject;
                            if (fieldType == null) Fail("INVALID_INSTRUCTION", "Unknown struct field " + field, path + ".fieldName");
                            Compatible(value["valueType"] as JObject, fieldType, path + ".value");
                        }
                    }
                    else Fail("UNSUPPORTED_INSTRUCTION", "Unknown container operation " + operation, path + ".containerOperation");
                    break;
                }
                case "choice":
                {
                    if (instruction["prompt"] != null) ValidateTemplate(instruction["prompt"], path + ".prompt");
                    JArray options = Array(instruction["options"], path + ".options");
                    if (options.Count == 0) Fail("EMPTY_CHOICE", "Choice has no options", path + ".options");
                    var ids = new HashSet<string>(StringComparer.Ordinal);
                    for (int index = 0; index < options.Count; index++)
                    {
                        string optionPath = path + ".options[" + index + "]";
                        JObject option = Object(options[index], optionPath);
                        string id = String(option, "id", optionPath);
                        if (!ids.Add(id)) Fail("DUPLICATE_OPTION_ID", "Duplicate choice option ID " + id, optionPath + ".id");
                        ValidateTemplate(option["text"], optionPath + ".text");
                        OptionalBooleanExpression(option, "visibleIf", optionPath);
                        OptionalBooleanExpression(option, "enabledIf", optionPath);
                        Target(String(option, "target", optionPath), optionPath + ".target");
                    }
                    break;
                }
                case "branch":
                    BooleanExpression(instruction["condition"], path + ".condition");
                    Target(String(instruction, "whenTrue", path), path + ".whenTrue");
                    Target(String(instruction, "whenFalse", path), path + ".whenFalse");
                    break;
                case "jump": Target(String(instruction, "target", path), path + ".target"); break;
                case "call-chapter": ValidateChapterCall(instruction, path); break;
                case "call-event":
                {
                    String(instruction, "eventId", path);
                    ExpressionMap(instruction["arguments"], path + ".arguments");
                    JArray outputs = Array(instruction["outputs"], path + ".outputs");
                    var ids = new HashSet<string>(StringComparer.Ordinal);
                    var types = new Dictionary<string, JObject>(StringComparer.Ordinal);
                    for (int index = 0; index < outputs.Count; index++)
                    {
                        string outputPath = path + ".outputs[" + index + "]";
                        JObject output = Object(outputs[index], outputPath);
                        string id = String(output, "id", outputPath);
                        if (!ids.Add(id)) Fail("DUPLICATE_ID", "Duplicate event output " + id, outputPath + ".id");
                        String(output, "name", outputPath);
                        types[id] = ValidateType(output["valueType"], outputPath + ".valueType");
                    }
                    ValidateResultVariables(instruction["resultVariableIds"], path + ".resultVariableIds", types);
                    OptionalVariable(instruction, "instanceVariableId", path);
                    break;
                }
                case "wait-signal":
                    String(instruction, "signalId", path);
                    ExpressionMap(instruction["matches"], path + ".matches");
                    break;
                case "start-story":
                case "switch-story":
                    String(instruction, "storyId", path);
                    OptionalExpression(instruction, "instanceId", path);
                    ExpressionMap(instruction["arguments"], path + ".arguments");
                    ValidateResultVariables(instruction["resultVariableIds"], path + ".resultVariableIds");
                    OptionalVariable(instruction, "instanceVariableId", path);
                    RequireBoolean(instruction["waitForCompletion"], path + ".waitForCompletion");
                    break;
                case "resume-story":
                    ValidateExpression(instruction["instanceId"], path + ".instanceId");
                    ValidateResultVariables(instruction["resultVariableIds"], path + ".resultVariableIds");
                    OptionalVariable(instruction, "instanceVariableId", path);
                    RequireBoolean(instruction["waitForCompletion"], path + ".waitForCompletion");
                    break;
                case "end-story-instance":
                    ValidateExpression(instruction["instanceId"], path + ".instanceId");
                    ValidateResultVariables(instruction["resultVariableIds"], path + ".resultVariableIds");
                    break;
                case "return":
                    HashSet<string> owners;
                    if (!chapterBlockOwners.TryGetValue(currentBlock, out owners)) Fail("INVALID_RETURN_LOCATION", "Return must be reachable from a chapter entry", path);
                    foreach (JProperty value in ExpressionMap(instruction["values"], path + ".values").Properties())
                    {
                        foreach (string owner in owners)
                        {
                            JObject output = ((JArray)chapters[owner]["outputs"]).OfType<JObject>().FirstOrDefault(item => (string)item["variableId"] == value.Name);
                            if (output == null) Fail("INVALID_OUTPUT", "Unknown output " + value.Name + " for chapter " + owner, path + ".values." + value.Name);
                            Compatible(value.Value["valueType"] as JObject, output["valueType"] as JObject, path + ".values." + value.Name);
                        }
                    }
                    break;
                case "end-story": break;
                default: Fail("UNSUPPORTED_INSTRUCTION", "Unsupported native instruction " + op, path + ".op"); break;
            }
        }

        private void ValidateChapterCall(JObject instruction, string path)
        {
            string chapterId = String(instruction, "chapterId", path);
            JObject chapter = chapters[chapterId] as JObject;
            if (chapter == null) Fail("MISSING_CHAPTER", "Chapter does not exist: " + chapterId, path + ".chapterId");
            string target = String(instruction, "target", path);
            Target(target, path + ".target");
            if (target != (string)chapter["entryBlockId"]) Fail("INVALID_INSTRUCTION", "Call must target the chapter entry block", path + ".target");
            JObject arguments = ExpressionMap(instruction["arguments"], path + ".arguments");
            var parameters = ((JArray)chapter["parameters"]).OfType<JObject>().ToDictionary(item => (string)item["variableId"], item => item, StringComparer.Ordinal);
            foreach (JProperty argument in arguments.Properties())
            {
                JObject parameter;
                if (!parameters.TryGetValue(argument.Name, out parameter)) Fail("INVALID_ARGUMENT", "Unknown chapter parameter " + argument.Name, path + ".arguments." + argument.Name);
                Compatible(argument.Value["valueType"] as JObject, parameter["valueType"] as JObject, path + ".arguments." + argument.Name);
            }
            JObject returnTo = Object(instruction["returnTo"], path + ".returnTo");
            string blockId = String(returnTo, "blockId", path + ".returnTo");
            Target(blockId, path + ".returnTo.blockId");
            if (returnTo["instructionIndex"]?.Type != JTokenType.Integer || (double)returnTo["instructionIndex"] < 0 || (double)returnTo["instructionIndex"] >= ((JArray)blocks[blockId]["instructions"]).Count)
                Fail("INVALID_RETURN_LOCATION", "Chapter return location is out of range", path + ".returnTo.instructionIndex");
            var outputs = ((JArray)chapter["outputs"]).OfType<JObject>().ToDictionary(item => (string)item["variableId"], item => item["valueType"] as JObject, StringComparer.Ordinal);
            ValidateResultVariables(instruction["resultVariableIds"], path + ".resultVariableIds", outputs);
        }

        private void FindChapterBlockOwners()
        {
            foreach (JProperty chapter in chapters.Properties())
            {
                var queue = new Queue<string>();
                var visited = new HashSet<string>(StringComparer.Ordinal);
                queue.Enqueue((string)chapter.Value["entryBlockId"]);
                while (queue.Count > 0)
                {
                    string id = queue.Dequeue();
                    if (!visited.Add(id) || !(blocks[id] is JObject block)) continue;
                    HashSet<string> owners;
                    if (!chapterBlockOwners.TryGetValue(id, out owners)) chapterBlockOwners[id] = owners = new HashSet<string>(StringComparer.Ordinal);
                    owners.Add(chapter.Name);
                    JObject last = ((JArray)block["instructions"]).Last as JObject;
                    if (last == null || last["op"]?.Type != JTokenType.String) continue;
                    string op = (string)last["op"];
                    var targets = new List<JToken>();
                    if (op == "jump") targets.Add(last["target"]);
                    if (op == "branch") { targets.Add(last["whenTrue"]); targets.Add(last["whenFalse"]); }
                    if (op == "choice" && last["options"] is JArray options)
                        targets.AddRange(options.OfType<JObject>().Select(option => option["target"]));
                    // A called chapter owns its own blocks. The caller owns only its continuation.
                    if (op == "call-chapter") targets.Add((last["returnTo"] as JObject)?["blockId"]);
                    foreach (JToken target in targets) if (target?.Type == JTokenType.String) queue.Enqueue((string)target);
                }
            }
        }

        private void ValidateResultVariables(JToken token, string path, Dictionary<string, JObject> outputTypes = null)
        {
            JObject variables = Object(token, path);
            foreach (JProperty variable in variables.Properties())
            {
                string id = RequireString(variable.Value, path + "." + variable.Name);
                JObject targetType = Variable(id, path + "." + variable.Name);
                if (outputTypes != null)
                {
                    JObject sourceType;
                    if (!outputTypes.TryGetValue(variable.Name, out sourceType)) Fail("INVALID_OUTPUT", "Unknown output " + variable.Name, path + "." + variable.Name);
                    Compatible(sourceType, targetType, path + "." + variable.Name);
                }
            }
        }

        private JObject ValidateExpression(JToken token, string path, int depth = 0)
        {
            if (depth > 64) Fail("INVALID_EXPRESSION", "Expression nesting exceeds 64 levels", path);
            JObject expression = Object(token, path);
            string kind = String(expression, "kind", path);
            JObject type = ValidateType(expression["valueType"], path + ".valueType");
            switch (kind)
            {
                case "literal":
                    if (expression.Property("value", StringComparison.Ordinal) == null || !StoryEvaluator.MatchesType(expression["value"], type))
                        Fail("INVALID_EXPRESSION", "Literal does not match its value type", path + ".value");
                    break;
                case "variable": Compatible(Variable(String(expression, "variableId", path), path + ".variableId"), type, path + ".valueType"); break;
                case "event-output":
                case "substory-output":
                case "signal-output":
                {
                    string instructionId = String(expression, "instructionId", path);
                    string outputId = String(expression, "outputId", path);
                    JObject producer;
                    if (!instructionsById.TryGetValue(instructionId, out producer)) Fail("INVALID_EXPRESSION", "Output references missing instruction " + instructionId, path + ".instructionId");
                    string expected = kind == "event-output" ? "call-event" : kind == "signal-output" ? "wait-signal" : "call-chapter";
                    if ((string)producer["op"] != expected) Fail("INVALID_EXPRESSION", "Output references incompatible instruction", path + ".instructionId");
                    if (kind == "event-output")
                    {
                        JArray outputs = Array(producer["outputs"], path + ".instructionId");
                        JObject output = outputs.OfType<JObject>().FirstOrDefault(item => (string)item["id"] == outputId);
                        if (output == null) Fail("INVALID_EXPRESSION", "Event output does not exist: " + outputId, path + ".outputId");
                        Compatible(ValidateType(output["valueType"], path + ".valueType"), type, path + ".valueType");
                    }
                    if (kind == "substory-output")
                    {
                        JObject chapter = chapters[(string)producer["chapterId"]] as JObject;
                        JObject output = (chapter?["outputs"] as JArray)?.OfType<JObject>().FirstOrDefault(item => (string)item["variableId"] == outputId);
                        if (output == null) Fail("INVALID_EXPRESSION", "Chapter output does not exist: " + outputId, path + ".outputId");
                        Compatible(output["valueType"] as JObject, type, path + ".valueType");
                    }
                    break;
                }
                case "unary":
                {
                    string op = String(expression, "operator", path);
                    if (op != "not" && op != "negate") Fail("INVALID_EXPRESSION", "Unsupported unary operator " + op, path + ".operator");
                    JObject operand = ValidateExpression(expression["operand"], path + ".operand", depth + 1);
                    ExpectedKind(operand["valueType"] as JObject, op == "not" ? "boolean" : "number", path + ".operand");
                    ExpectedKind(type, op == "not" ? "boolean" : "number", path + ".valueType");
                    break;
                }
                case "binary":
                {
                    string op = String(expression, "operator", path);
                    if (!BinaryOperators.Contains(op)) Fail("INVALID_EXPRESSION", "Unsupported binary operator " + op, path + ".operator");
                    JObject left = ValidateExpression(expression["left"], path + ".left", depth + 1);
                    JObject right = ValidateExpression(expression["right"], path + ".right", depth + 1);
                    JObject leftType = left["valueType"] as JObject;
                    JObject rightType = right["valueType"] as JObject;
                    if (op == "and" || op == "or")
                    {
                        ExpectedKind(leftType, "boolean", path + ".left");
                        ExpectedKind(rightType, "boolean", path + ".right");
                        ExpectedKind(type, "boolean", path + ".valueType");
                    }
                    else if (op == "equal" || op == "not-equal") ExpectedKind(type, "boolean", path + ".valueType");
                    else if (op == "less-than" || op == "less-than-or-equal" || op == "greater-than" || op == "greater-than-or-equal")
                    {
                        string leftKind = (string)leftType["kind"];
                        if (leftKind != "number" && leftKind != "string" && leftKind != "any") Fail("INVALID_EXPRESSION", "Ordered comparison requires Number or String", path + ".left");
                        Compatible(leftType, rightType, path + ".right");
                        ExpectedKind(type, "boolean", path + ".valueType");
                    }
                    else
                    {
                        string expected = op == "add" && (string)leftType["kind"] == "string" ? "string" : "number";
                        ExpectedKind(leftType, expected, path + ".left");
                        ExpectedKind(rightType, expected, path + ".right");
                        ExpectedKind(type, expected, path + ".valueType");
                    }
                    break;
                }
                case "member":
                {
                    JObject target = ValidateExpression(expression["target"], path + ".target", depth + 1);
                    string member = String(expression, "member", path);
                    JObject targetType = target["valueType"] as JObject;
                    string targetKind = (string)targetType["kind"];
                    if (targetKind != "struct" && targetKind != "json" && targetKind != "any") Fail("INVALID_EXPRESSION", "Member access requires a structured value", path + ".target");
                    if (targetKind == "struct")
                    {
                        JObject memberType = targetType["fields"]?[member] as JObject;
                        if (memberType == null) Fail("INVALID_EXPRESSION", "Unknown struct field " + member, path + ".member");
                        Compatible(memberType, type, path + ".valueType");
                    }
                    break;
                }
                case "index":
                {
                    JObject target = ValidateExpression(expression["target"], path + ".target", depth + 1);
                    JObject index = ValidateExpression(expression["index"], path + ".index", depth + 1);
                    JObject targetType = target["valueType"] as JObject;
                    string targetKind = (string)targetType["kind"];
                    if (targetKind != "array" && targetKind != "map" && targetKind != "any") Fail("INVALID_EXPRESSION", "Index access requires Array or Map", path + ".target");
                    if (targetKind == "array") ExpectedKind(index["valueType"] as JObject, "number", path + ".index");
                    JObject itemType = targetType[targetKind == "array" ? "elementType" : "valueType"] as JObject;
                    if (itemType != null) Compatible(itemType, type, path + ".valueType");
                    break;
                }
                case "convert":
                    ValidateExpression(expression["target"], path + ".target", depth + 1);
                    Compatible(ValidateType(expression["to"], path + ".to"), type, path + ".valueType");
                    break;
                default: Fail("INVALID_EXPRESSION", "Unsupported expression " + kind, path + ".kind"); break;
            }
            return expression;
        }

        internal JObject ValidateType(JToken token, string path, int depth = 0)
        {
            if (depth > 64) Fail("INVALID_VALUE_TYPE", "Value type nesting exceeds 64 levels", path);
            JObject type = Object(token, path);
            string kind = String(type, "kind", path);
            if (type["nullable"] != null) RequireBoolean(type["nullable"], path + ".nullable");
            switch (kind)
            {
                case "any": case "boolean": case "number": case "string": case "character-ref": case "asset-ref": break;
                case "array":
                    if (type["elementType"] != null) ValidateType(type["elementType"], path + ".elementType", depth + 1);
                    break;
                case "map":
                    string key = OptionalString(type, "keyType", path);
                    if (key != null && key != "string" && key != "number" && key != "character-ref" && key != "asset-ref")
                        Fail("INVALID_VALUE_TYPE", "Unsupported Map key type " + key, path + ".keyType");
                    if (type["valueType"] != null) ValidateType(type["valueType"], path + ".valueType", depth + 1);
                    break;
                case "json": String(type, "name", path); break;
                case "enum":
                    String(type, "name", path);
                    JArray values = Array(type["values"], path + ".values");
                    if (values.Count == 0) Fail("INVALID_VALUE_TYPE", "Enum must contain values", path + ".values");
                    Strings(values, path + ".values");
                    if (values.Select(value => (string)value).Distinct(StringComparer.Ordinal).Count() != values.Count) Fail("INVALID_VALUE_TYPE", "Enum contains duplicate values", path + ".values");
                    break;
                case "struct":
                    String(type, "name", path);
                    foreach (JProperty field in Object(type["fields"], path + ".fields").Properties())
                    {
                        if (string.IsNullOrWhiteSpace(field.Name)) Fail("INVALID_VALUE_TYPE", "Struct field name is empty", path + ".fields");
                        ValidateType(field.Value, path + ".fields." + field.Name, depth + 1);
                    }
                    break;
                default: Fail("INVALID_VALUE_TYPE", "Unsupported value type " + kind, path + ".kind"); break;
            }
            return type;
        }

        private void ValidateTemplate(JToken token, string path)
        {
            JObject template = Object(token, path);
            String(template, "id", path);
            ValidateParts(template["parts"], path + ".parts");
            if (template["locales"] is JObject locales)
                foreach (JProperty locale in locales.Properties()) ValidateParts(Object(locale.Value, path + ".locales." + locale.Name)["parts"], path + ".locales." + locale.Name + ".parts");
            else if (template["locales"] != null) Fail("INVALID_PROGRAM", "Template locales must be an object", path + ".locales");
        }
        private void ValidateParts(JToken token, string path)
        {
            JArray parts = Array(token, path);
            for (int index = 0; index < parts.Count; index++)
            {
                string partPath = path + "[" + index + "]";
                JObject part = Object(parts[index], partPath);
                string kind = String(part, "kind", partPath);
                if (kind == "text")
                {
                    if (part["value"]?.Type != JTokenType.String) Fail("INVALID_PROGRAM", "Text part must contain a string", partPath + ".value");
                }
                else if (kind == "expression") ValidateExpression(part["expression"], partPath + ".expression");
                else Fail("INVALID_PROGRAM", "Unsupported text part " + kind, partPath + ".kind");
            }
        }
        private void ValidateVoice(JToken token, string path)
        {
            if (token == null) return;
            JObject voice = Object(token, path);
            OptionalString(voice, "default", path);
            if (voice["locales"] != null)
                foreach (JProperty locale in Object(voice["locales"], path + ".locales").Properties()) RequireString(locale.Value, path + ".locales." + locale.Name);
        }
        private JObject ExpressionMap(JToken token, string path)
        {
            JObject map = Object(token, path);
            foreach (JProperty property in map.Properties()) ValidateExpression(property.Value, path + "." + property.Name);
            return map;
        }
        private void BooleanExpression(JToken token, string path) { ExpectedKind(ValidateExpression(token, path)["valueType"] as JObject, "boolean", path + ".valueType"); }
        private void OptionalBooleanExpression(JObject value, string name, string path) { if (value[name] != null) BooleanExpression(value[name], path + "." + name); }
        private void OptionalExpression(JObject value, string name, string path) { if (value[name] != null) ValidateExpression(value[name], path + "." + name); }
        private void OptionalVariable(JObject value, string name, string path) { if (value[name] != null) Variable(String(value, name, path), path + "." + name); }
        private void ExpectedKind(JObject type, string kind, string path)
        {
            if ((string)type?["kind"] != kind && (string)type?["kind"] != "any") Fail("INVALID_EXPRESSION", "Expected " + kind + " expression", path);
        }
        private void Compatible(JObject source, JObject target, string path)
        {
            string sourceKind = (string)source?["kind"];
            string targetKind = (string)target?["kind"];
            if (sourceKind != "any" && targetKind != "any" && sourceKind != targetKind)
                Fail("TYPE_MISMATCH", "Cannot assign " + sourceKind + " to " + targetKind, path);
        }
        private JObject Variable(string id, string path)
        {
            JObject type;
            if (!variableTypes.TryGetValue(id, out type)) Fail("MISSING_VARIABLE", "Variable does not exist: " + id, path);
            return type;
        }
        private void Target(string id, string path) { if (blocks[id] == null) Fail("MISSING_BLOCK", "Target block does not exist: " + id, path); }
        private JObject Object(JToken token, string path)
        {
            if (!(token is JObject value)) Fail("INVALID_PROGRAM", "Expected object", path);
            return (JObject)token;
        }
        private JArray Array(JToken token, string path)
        {
            if (!(token is JArray value)) Fail("INVALID_PROGRAM", "Expected array", path);
            return (JArray)token;
        }
        private string String(JObject value, string name, string path) { return RequireString(value[name], path + "." + name); }
        private string RequireString(JToken value, string path)
        {
            if (value?.Type != JTokenType.String || string.IsNullOrWhiteSpace((string)value)) Fail("INVALID_PROGRAM", "Expected nonempty string", path);
            return (string)value;
        }
        private void StringValue(JToken value, string path) { if (value?.Type != JTokenType.String) Fail("INVALID_PROGRAM", "Expected string", path); }
        private string OptionalString(JObject value, string name, string path) { return value[name] == null ? null : RequireString(value[name], path + "." + name); }
        private void Strings(JArray values, string path)
        {
            for (int index = 0; index < values.Count; index++) RequireString(values[index], path + "[" + index + "]");
        }
        private void RequireBoolean(JToken value, string path) { if (value?.Type != JTokenType.Boolean) Fail("INVALID_PROGRAM", "Expected boolean", path); }
        private void Fail(string code, string message, string path)
        {
            throw new StoryRuntimeException(code, message, path, storyId, currentBlock, currentInstruction);
        }
    }
}
