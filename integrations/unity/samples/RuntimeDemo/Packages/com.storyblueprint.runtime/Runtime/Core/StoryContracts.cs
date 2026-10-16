using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace StoryBlueprint.Runtime
{
    public enum PlaybackMode { Manual, Automatic }

    public sealed class StoryRuntimeException : Exception
    {
        public string Code { get; }
        public string JsonPath { get; }
        public string StoryId { get; }
        public string BlockId { get; }
        public string InstructionId { get; }
        public StoryRuntimeException(string code, string message, string path = "$", string storyId = null,
            string blockId = null, string instructionId = null, Exception innerException = null)
            : base(message, innerException)
        {
            Code = code; JsonPath = path; StoryId = storyId; BlockId = blockId; InstructionId = instructionId;
        }
    }

    public sealed class DialogueRequest
    {
        public string RequestId { get; set; }
        public string SpeakerId { get; set; }
        public string TextId { get; set; }
        public string Text { get; set; }
        public string VoiceAssetId { get; set; }
        public string Emotion { get; set; }
        public string PortraitId { get; set; }
        public IReadOnlyList<string> Tags { get; set; } = Array.Empty<string>();
    }
    public sealed class NarrationRequest
    {
        public string RequestId { get; set; }
        public string TextId { get; set; }
        public string Text { get; set; }
        public string VoiceAssetId { get; set; }
    }
    public sealed class ChoiceOption
    {
        public string Id { get; set; }
        public string TextId { get; set; }
        public string Text { get; set; }
        public bool Enabled { get; set; }
    }
    public sealed class ChoiceRequest
    {
        public string RequestId { get; set; }
        public string PromptTextId { get; set; }
        public string Prompt { get; set; }
        public IReadOnlyList<ChoiceOption> Options { get; set; } = Array.Empty<ChoiceOption>();
    }
    public sealed class EventRequest
    {
        public string RequestId { get; set; }
        public string EventId { get; set; }
        public JObject Arguments { get; set; } = new JObject();
        public JArray Outputs { get; set; } = new JArray();
    }
    public sealed class SignalRequest
    {
        public string RequestId { get; set; }
        public string SignalId { get; set; }
        public JObject Matches { get; set; } = new JObject();
    }
    public sealed class StoryControlRequest
    {
        public string RequestId { get; set; }
        public string Operation { get; set; }
        public string StoryId { get; set; }
        public string InstanceId { get; set; }
        public JObject Arguments { get; set; } = new JObject();
        public bool WaitForCompletion { get; set; }
    }
    public sealed class StoryControlResult
    {
        public string InstanceId { get; set; }
        public JObject Values { get; set; } = new JObject();
    }

    public interface IStoryPresenter
    {
        Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken);
        Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken);
        Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken);
    }
    public interface IStoryAdapter : IStoryPresenter
    {
        Task<JObject> CallEventAsync(EventRequest request, CancellationToken cancellationToken);
        Task<JObject> WaitForSignalAsync(SignalRequest request, CancellationToken cancellationToken);
        Task<JToken> ReadExternalVariableAsync(JObject definition, CancellationToken cancellationToken);
        Task WriteExternalVariableAsync(JObject definition, JToken value, CancellationToken cancellationToken);
        Task<StoryControlResult> ControlStoryAsync(StoryControlRequest request, CancellationToken cancellationToken);
        Task<string> ResolveTextAsync(string textId, string locale, CancellationToken cancellationToken);
    }

    /// <summary>Override only the game capabilities you use. Unsupported interactions fail explicitly.</summary>
    public abstract class StoryAdapter : IStoryAdapter
    {
        public virtual Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken)
            => throw new NotSupportedException("A dialogue presenter is required");
        public virtual Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken)
            => PresentDialogueAsync(new DialogueRequest { RequestId = request.RequestId, TextId = request.TextId,
                Text = request.Text, VoiceAssetId = request.VoiceAssetId }, mode, cancellationToken);
        public virtual Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken)
            => throw new NotSupportedException("A choice presenter is required");
        public virtual Task<JObject> CallEventAsync(EventRequest request, CancellationToken cancellationToken)
            => throw new NotSupportedException("No event handler for " + request.EventId);
        public virtual async Task<JObject> WaitForSignalAsync(SignalRequest request, CancellationToken cancellationToken)
        {
            // Hosts can send directly through StoryRuntime.SendSignal without installing a signal bus.
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return null;
        }
        public virtual Task<JToken> ReadExternalVariableAsync(JObject definition, CancellationToken cancellationToken)
            => Task.FromResult((definition["defaultValue"] ?? JValue.CreateNull()).DeepClone());
        public virtual Task WriteExternalVariableAsync(JObject definition, JToken value, CancellationToken cancellationToken)
            => Task.CompletedTask;
        public virtual Task<StoryControlResult> ControlStoryAsync(StoryControlRequest request, CancellationToken cancellationToken)
            => throw new NotSupportedException("Story Control requires a host instance manager");
        public virtual Task<string> ResolveTextAsync(string textId, string locale, CancellationToken cancellationToken)
            => Task.FromResult<string>(null);
    }
}
