using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace StoryBlueprint.Unity
{
    /// <summary>Marshals adapter callbacks to Unity's main thread and cancels them with the owning object.</summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-100)]
    public sealed class UnityMainThreadDispatcher : MonoBehaviour
    {
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();
        private readonly object _gate = new object();
        private CancellationTokenSource _lifetime;
        private int _threadId;
        private bool _destroyed;
        private bool _available;

        private void Awake() { _threadId = Thread.CurrentThread.ManagedThreadId; }

        private void OnEnable()
        {
            lock (_gate)
            {
                if (_destroyed) return;
                _lifetime = new CancellationTokenSource();
                _available = true;
            }
        }

        public bool IsMainThread { get { return Thread.CurrentThread.ManagedThreadId == _threadId; } }

        public Task<T> InvokeAsync<T>(Func<CancellationToken, Task<T>> action, CancellationToken cancellationToken = default)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            CancellationTokenSource linked;
            lock (_gate)
            {
                if (_destroyed || !_available) return Task.FromCanceled<T>(new CancellationToken(true));
                linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _lifetime.Token);
            }
            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var registration = linked.Token.Register(() => completion.TrySetCanceled());
            Action execute = async () =>
            {
                try
                {
                    if (completion.Task.IsCompleted) return;
                    linked.Token.ThrowIfCancellationRequested();
                    completion.TrySetResult(await action(linked.Token));
                }
                catch (OperationCanceledException) { completion.TrySetCanceled(); }
                catch (Exception error) { completion.TrySetException(error); }
                finally { registration.Dispose(); linked.Dispose(); }
            };
            if (!TryPost(execute))
            {
                completion.TrySetCanceled();
                registration.Dispose();
                linked.Dispose();
            }
            return completion.Task;
        }

        public async Task InvokeAsync(Func<CancellationToken, Task> action, CancellationToken cancellationToken = default)
        {
            await InvokeAsync(async token => { await action(token); return true; }, cancellationToken);
        }

        public void Post(Action action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            TryPost(action);
        }

        private bool TryPost(Action action)
        {
            lock (_gate)
            {
                if (_destroyed || !_available) return false;
                if (!IsMainThread) { _queue.Enqueue(action); return true; }
            }
            action();
            return true;
        }

        private void Update()
        {
            while (_queue.TryDequeue(out var action)) action();
        }

        private void CancelLifetime()
        {
            lock (_gate)
            {
                _available = false;
                _lifetime?.Cancel();
                _lifetime?.Dispose();
                _lifetime = null;
            }
            // Execute only cancellation/cleanup paths for operations that had not reached the main thread.
            while (_queue.TryDequeue(out var action)) action();
        }

        private void OnDisable() { CancelLifetime(); }
        private void OnDestroy()
        {
            lock (_gate) { _destroyed = true; }
            CancelLifetime();
        }
    }
}
