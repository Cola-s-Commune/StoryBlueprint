using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StoryBlueprint.Runtime;

public enum PlaybackMode { Manual, Automatic }

public sealed record DialogueRequest(string RequestId, string? SpeakerId, string Text, IReadOnlyList<string>? Tags);
public sealed record NarrationRequest(string RequestId, string Text);
public sealed record ChoiceOption(string Id, string Text, bool Enabled);
public sealed record ChoiceRequest(string RequestId, string? Prompt, IReadOnlyList<ChoiceOption> Options);

public interface IStoryPresenter
{
    Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken);
    Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken);
    Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken);
}

public sealed class StoryProgram
{
    public string Format { get; init; } = "";
    public int Version { get; init; }
    public string Id { get; init; } = "";
    public string ContentVersion { get; init; } = "";
    public string EntryBlockId { get; init; } = "";
    public Dictionary<string, StoryBlock> Blocks { get; init; } = new();
    public List<StoryVariable> Variables { get; init; } = new();

    public static StoryProgram Parse(string json)
    {
        var program = JsonSerializer.Deserialize<StoryProgram>(json, JsonOptions)
            ?? throw new ArgumentException("Empty Story Blueprint program", nameof(json));
        if (program.Format != "story-runtime" || program.Version != 7)
            throw new NotSupportedException($"Unsupported story-runtime version {program.Version}");
        if (string.IsNullOrWhiteSpace(program.EntryBlockId) || !program.Blocks.ContainsKey(program.EntryBlockId))
            throw new FormatException($"Missing entry block {program.EntryBlockId}");
        return program;
    }

    public static StoryProgram ParseProject(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.TryGetProperty("format", out var format) && format.GetString() == "story-runtime")
            return Parse(json);
        if (root.GetProperty("format").GetString() != "story-blueprint-compiled-project")
            throw new NotSupportedException("Unsupported compiled Story Blueprint project");
        var stories = root.GetProperty("stories");
        var entry = root.GetProperty("entryStoryId").GetString() ?? throw new FormatException("Missing entryStoryId");
        return Parse(stories.GetProperty(entry).GetProperty("program").GetRawText());
    }

    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
}

public sealed class StoryBlock { public string Id { get; init; } = ""; public List<StoryInstruction> Instructions { get; init; } = new(); }
public sealed class StoryVariable { public string Id { get; init; } = ""; public JsonElement DefaultValue { get; init; } }
public sealed class StoryInstruction
{
    public string Id { get; init; } = ""; public string Op { get; init; } = "";
    public string? Target { get; init; } public string? WhenTrue { get; init; } public string? WhenFalse { get; init; }
    public string? VariableId { get; init; } public JsonElement Value { get; init; }
    public StoryText? Text { get; init; } public StoryText? Prompt { get; init; }
    public List<StoryChoiceOption>? Options { get; init; } public StoryExpression? Condition { get; init; }
    public string? SpeakerId { get; init; } public List<string>? Tags { get; init; }
}
public sealed class StoryChoiceOption { public string Id { get; init; } = ""; public StoryText Text { get; init; } = new(); public string Target { get; init; } = ""; public bool? Enabled { get; init; } }
public sealed class StoryText { public string Id { get; init; } = ""; public List<StoryTextPart> Parts { get; init; } = new(); }
public sealed class StoryTextPart { public string Kind { get; init; } = ""; public string? Value { get; init; } public StoryExpression? Expression { get; init; } }
public sealed class StoryExpression
{
    public string Kind { get; init; } = ""; public JsonElement Value { get; init; } public string? VariableId { get; init; }
    public StoryExpression? Left { get; init; } public StoryExpression? Right { get; init; } public string? Operator { get; init; }
}

public sealed class StoryRuntime
{
    private readonly StoryProgram _program; private readonly IStoryPresenter _presenter;
    private readonly Dictionary<string, object?> _variables = new(); private string _blockId; private int _index; private bool _completed;
    public StoryRuntime(StoryProgram program, IStoryPresenter presenter)
    {
        _program = program ?? throw new ArgumentNullException(nameof(program)); _presenter = presenter ?? throw new ArgumentNullException(nameof(presenter)); _blockId = program.EntryBlockId;
        foreach (var variable in program.Variables) _variables[variable.Id] = ToObject(variable.DefaultValue);
    }
    public IReadOnlyDictionary<string, object?> Variables => _variables; public bool IsCompleted => _completed;
    public async Task RunAsync(PlaybackMode mode = PlaybackMode.Manual, CancellationToken cancellationToken = default)
    {
        while (!_completed)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_program.Blocks.TryGetValue(_blockId, out var block) || _index >= block.Instructions.Count) throw new InvalidOperationException($"Invalid story location {_blockId}:{_index}");
            var instruction = block.Instructions[_index];
            switch (instruction.Op)
            {
                case "dialogue": await _presenter.PresentDialogueAsync(new DialogueRequest(instruction.Id, instruction.SpeakerId, Render(instruction.Text), instruction.Tags), mode, cancellationToken); _index++; break;
                case "narration": await _presenter.PresentNarrationAsync(new NarrationRequest(instruction.Id, Render(instruction.Text)), mode, cancellationToken); _index++; break;
                case "choice":
                    var options = new List<ChoiceOption>(); foreach (var option in instruction.Options ?? new()) options.Add(new ChoiceOption(option.Id, Render(option.Text), option.Enabled != false));
                    var selected = await _presenter.PresentChoiceAsync(new ChoiceRequest(instruction.Id, instruction.Prompt == null ? null : Render(instruction.Prompt), options), cancellationToken);
                    var target = (instruction.Options ?? new()).Find(o => o.Id == selected && o.Enabled != false)?.Target ?? throw new InvalidOperationException($"Invalid choice option {selected}"); Jump(target); break;
                case "jump": Jump(instruction.Target); break;
                case "branch": Jump(Evaluate(instruction.Condition) is true ? instruction.WhenTrue : instruction.WhenFalse); break;
                case "set-variable": _variables[instruction.VariableId ?? throw new FormatException("set-variable missing variableId")] = Evaluate(instruction.Value); _index++; break;
                case "end-story": _completed = true; break;
                default: throw new NotSupportedException($"Instruction {instruction.Op} is not supported by the Unity core runtime");
            }
        }
    }
    private void Jump(string? target) { if (string.IsNullOrWhiteSpace(target)) throw new FormatException("Jump target is missing"); _blockId = target; _index = 0; }
    private string Render(StoryText? text) { if (text == null) return ""; var result = ""; foreach (var part in text.Parts) result += part.Kind == "text" ? part.Value ?? "" : Convert.ToString(Evaluate(part.Expression), CultureInfo.InvariantCulture); return result; }
    private object? Evaluate(JsonElement value) => ToObject(value);
    private object? Evaluate(StoryExpression? expression)
    {
        if (expression == null) return null; if (expression.Kind == "literal") return ToObject(expression.Value); if (expression.Kind == "variable") return _variables.TryGetValue(expression.VariableId ?? "", out var value) ? value : null;
        var left = Evaluate(expression.Left); var right = Evaluate(expression.Right); return expression.Operator switch { "equal" => Equals(left, right), "not-equal" => !Equals(left, right), "and" => left is true && right is true, "or" => left is true || right is true, _ => throw new NotSupportedException($"Expression operator {expression.Operator} is not supported") };
    }
    private static object? ToObject(JsonElement element) => element.ValueKind switch { JsonValueKind.Null => null, JsonValueKind.True => true, JsonValueKind.False => false, JsonValueKind.Number => element.TryGetInt64(out var i) ? i : element.GetDouble(), JsonValueKind.String => element.GetString(), JsonValueKind.Array => new List<object?>(System.Linq.Enumerable.Select(element.EnumerateArray(), ToObject)), JsonValueKind.Object => System.Linq.Enumerable.ToDictionary(element.EnumerateObject(), p => p.Name, p => ToObject(p.Value)), _ => null };
}
