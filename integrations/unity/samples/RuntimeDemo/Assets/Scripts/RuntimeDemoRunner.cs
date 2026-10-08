using System.IO;
using System.Threading;
using StoryBlueprint.Runtime;
using UnityEngine;

public sealed class RuntimeDemoRunner : MonoBehaviour
{
    [SerializeField] private RuntimeDemoPresenter presenter = null!;
    [SerializeField] private string compiledStoryPath = "sample-quest.storyc.json";
    private CancellationTokenSource? cancellation;

    private async void Start()
    {
        cancellation = new CancellationTokenSource();
        try
        {
            var path = Path.Combine(Application.streamingAssetsPath, compiledStoryPath);
            var json = File.ReadAllText(path);
            var program = StoryProgram.ParseProject(json);
            await new StoryRuntime(program, presenter).RunAsync(presenter.PlaybackMode, cancellation.Token);
            Debug.Log("Story Blueprint RuntimeDemo completed.");
        }
        catch (System.Exception error)
        {
            Debug.LogException(error);
        }
    }

    private void OnDestroy()
    {
        cancellation?.Cancel();
        cancellation?.Dispose();
    }
}
