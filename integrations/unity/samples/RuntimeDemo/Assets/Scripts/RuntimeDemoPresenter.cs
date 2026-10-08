using System.Threading;
using System.Threading.Tasks;
using StoryBlueprint.Runtime;
using UnityEngine;

public sealed class RuntimeDemoPresenter : MonoBehaviour, IStoryPresenter
{
    [SerializeField] private PlaybackMode playbackMode = PlaybackMode.Manual;
    public PlaybackMode PlaybackMode => playbackMode;
    public Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken)
    {
        Debug.Log($"[{mode}] {request.SpeakerId}: {request.Text}");
        return Task.CompletedTask;
    }
    public Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken)
    {
        Debug.Log($"[{mode}] {request.Text}");
        return Task.CompletedTask;
    }
    public Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken)
    {
        Debug.Log($"Choice: {request.Prompt}");
        return Task.FromResult(request.Options[0].Id);
    }
}
