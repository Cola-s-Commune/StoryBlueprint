using System;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using UnityEngine;

namespace StoryBlueprint.Unity
{
    /// <summary>Game component contract for a Blueprint External Function.</summary>
    public interface IUnityStoryExternalFunctionHandler
    {
        Task<JObject> InvokeAsync(EventRequest request, CancellationToken cancellationToken);
    }

    /// <summary>Game component contract for forwarding one game event into a Blueprint Signal.</summary>
    public interface IUnityStorySignalSource
    {
        IDisposable Subscribe(Action<JObject> onSignal);
    }

    [Serializable]
    public sealed class UnityStoryExternalFunctionBinding
    {
        [SerializeField] private string functionId;
        [SerializeField] private MonoBehaviour handler;
        public string FunctionId { get { return functionId; } }
        public MonoBehaviour Handler { get { return handler; } }
    }

    [Serializable]
    public sealed class UnityStorySignalBinding
    {
        [SerializeField] private string signalId;
        [SerializeField] private MonoBehaviour source;
        public string SignalId { get { return signalId; } }
        public MonoBehaviour Source { get { return source; } }
    }
}
