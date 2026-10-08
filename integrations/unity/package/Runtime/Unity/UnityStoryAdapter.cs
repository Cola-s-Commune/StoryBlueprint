using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;

namespace StoryBlueprint.Unity
{
    /// <summary>Connects stable story IDs to game callbacks, always on the Unity main thread.</summary>
    public class UnityStoryAdapter : StoryAdapter
    {
        private readonly UnityStoryPresenter _presenter;
        private readonly UnityMainThreadDispatcher _dispatcher;
        private readonly Dictionary<string, Func<EventRequest, CancellationToken, Task<JObject>>> _events =
            new Dictionary<string, Func<EventRequest, CancellationToken, Task<JObject>>>(StringComparer.Ordinal);

        public UnityStoryAdapter(UnityStoryPresenter presenter)
        {
            _presenter = presenter ?? throw new ArgumentNullException(nameof(presenter));
            _dispatcher = presenter.Dispatcher ?? throw new InvalidOperationException("Create the adapter after the presenter's Awake has run.");
        }

        public Func<SignalRequest, CancellationToken, Task<JObject>> SignalHandler { get; set; }
        public Func<JObject, CancellationToken, Task<JToken>> ExternalVariableReader { get; set; }
        public Func<JObject, JToken, CancellationToken, Task> ExternalVariableWriter { get; set; }
        public Func<StoryControlRequest, CancellationToken, Task<StoryControlResult>> StoryController { get; set; }
        public Func<string, string, CancellationToken, Task<string>> TextResolver { get; set; }

        public void RegisterEvent(string eventId, Func<EventRequest, CancellationToken, Task<JObject>> handler)
        {
            if (string.IsNullOrWhiteSpace(eventId)) throw new ArgumentException("A stable Event ID is required.", nameof(eventId));
            _events[eventId] = handler ?? throw new ArgumentNullException(nameof(handler));
        }

        public override Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken)
        { return _presenter.PresentDialogueAsync(request, mode, cancellationToken); }

        public override Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken)
        { return _presenter.PresentNarrationAsync(request, mode, cancellationToken); }

        public override Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken)
        { return _presenter.PresentChoiceAsync(request, cancellationToken); }

        public override Task<JObject> CallEventAsync(EventRequest request, CancellationToken cancellationToken)
        {
            if (!_events.TryGetValue(request.EventId, out var handler)) return base.CallEventAsync(request, cancellationToken);
            return _dispatcher.InvokeAsync(token => handler(request, token), cancellationToken);
        }

        public override Task<JObject> WaitForSignalAsync(SignalRequest request, CancellationToken cancellationToken)
        {
            return SignalHandler == null ? base.WaitForSignalAsync(request, cancellationToken) :
                _dispatcher.InvokeAsync(token => SignalHandler(request, token), cancellationToken);
        }

        public override Task<JToken> ReadExternalVariableAsync(JObject variableDefinition, CancellationToken cancellationToken)
        {
            return ExternalVariableReader == null ? base.ReadExternalVariableAsync(variableDefinition, cancellationToken) :
                _dispatcher.InvokeAsync(token => ExternalVariableReader(variableDefinition, token), cancellationToken);
        }

        public override Task WriteExternalVariableAsync(JObject variableDefinition, JToken value, CancellationToken cancellationToken)
        {
            return ExternalVariableWriter == null ? base.WriteExternalVariableAsync(variableDefinition, value, cancellationToken) :
                _dispatcher.InvokeAsync(token => ExternalVariableWriter(variableDefinition, value, token), cancellationToken);
        }

        public override Task<StoryControlResult> ControlStoryAsync(StoryControlRequest request, CancellationToken cancellationToken)
        {
            return StoryController == null ? base.ControlStoryAsync(request, cancellationToken) :
                _dispatcher.InvokeAsync(token => StoryController(request, token), cancellationToken);
        }

        public override Task<string> ResolveTextAsync(string textId, string locale, CancellationToken cancellationToken)
        {
            return TextResolver == null ? base.ResolveTextAsync(textId, locale, cancellationToken) :
                _dispatcher.InvokeAsync(token => TextResolver(textId, locale, token), cancellationToken);
        }
    }
}
