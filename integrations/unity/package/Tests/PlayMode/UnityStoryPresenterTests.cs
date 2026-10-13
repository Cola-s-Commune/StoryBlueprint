using System;
using System.Collections;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using StoryBlueprint.Runtime;
using UnityEngine;
using UnityEngine.TestTools;

namespace StoryBlueprint.Unity.Tests
{
    public sealed class UnityStoryPresenterTests
    {
        private GameObject _object;
        private UnityStoryPresenter _presenter;

        [SetUp]
        public void SetUp()
        {
            _object = new GameObject("Presenter test");
            _presenter = _object.AddComponent<UnityStoryPresenter>();
        }

        [TearDown]
        public void TearDown() { if (_object != null) UnityEngine.Object.DestroyImmediate(_object); }

        [UnityTest]
        public IEnumerator ManualDialogueRevealsBeforeAdvancing()
        {
            var task = _presenter.PresentDialogueAsync(new DialogueRequest { RequestId = "line", Text = "Hello, traveler." }, PlaybackMode.Manual, CancellationToken.None);
            Assert.IsFalse(task.IsCompleted);
            _presenter.Advance();
            Assert.AreEqual("Hello, traveler.", _presenter.DisplayedText);
            Assert.IsFalse(task.IsCompleted, "Revealing a line must not resolve the interaction.");
            _presenter.Advance();
            yield return Await(task);
            Assert.IsFalse(_presenter.HasPendingInteraction);
        }

        [UnityTest]
        public IEnumerator AutomaticNarrationAdvancesButChoicesWait()
        {
            _presenter.CharactersPerSecond = 0;
            _presenter.AutomaticMinimumSeconds = 0;
            _presenter.AutomaticSecondsPerCharacter = 0;
            var narration = _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "narration", Text = "Night falls." }, PlaybackMode.Automatic, CancellationToken.None);
            yield return Await(narration);
            var choice = _presenter.PresentChoiceAsync(new ChoiceRequest
            {
                RequestId = "choice",
                Options = new[] { new ChoiceOption { Id = "locked", Text = "Locked", Enabled = false }, new ChoiceOption { Id = "enter", Text = "Enter", Enabled = true } }
            }, CancellationToken.None);
            yield return null;
            yield return null;
            Assert.IsFalse(choice.IsCompleted, "Automatic playback must pause at choices.");
            Assert.IsFalse(_presenter.SelectChoice("locked"));
            Assert.IsFalse(_presenter.SelectChoice("unknown"));
            Assert.IsFalse(choice.IsCompleted);
            Assert.IsTrue(_presenter.SelectChoice("enter"));
            yield return Await(choice);
            Assert.AreEqual("enter", choice.Result);
        }

        [UnityTest]
        public IEnumerator CancellationClearsOldRequestWithoutAdvancingReplacement()
        {
            using (var cancellation = new CancellationTokenSource())
            {
                var old = _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "old", Text = "Old line" }, PlaybackMode.Manual, cancellation.Token);
                cancellation.Cancel();
                yield return WaitUntilComplete(old);
                Assert.IsTrue(old.IsCanceled);
                Assert.IsFalse(_presenter.HasPendingInteraction);
                var next = _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "next", Text = "Replacement" }, PlaybackMode.Manual, CancellationToken.None);
                yield return null;
                Assert.IsFalse(next.IsCompleted);
                Assert.IsTrue(_presenter.HasPendingInteraction);
                _presenter.RevealText();
                _presenter.Advance();
                yield return Await(next);
            }
        }

        [UnityTest]
        public IEnumerator ObjectDestructionCancelsPendingChoice()
        {
            var task = _presenter.PresentChoiceAsync(new ChoiceRequest
            {
                RequestId = "choice",
                Options = new[] { new ChoiceOption { Id = "accept", Text = "Accept", Enabled = true } }
            }, CancellationToken.None);
            UnityEngine.Object.Destroy(_object);
            yield return WaitUntilComplete(task);
            Assert.IsTrue(task.IsCanceled);
        }

        [UnityTest]
        public IEnumerator WorkerThreadPresentationNotifiesOnMainThread()
        {
            var mainThread = Thread.CurrentThread.ManagedThreadId;
            var callbackThread = 0;
            _presenter.NarrationPresented += _ => callbackThread = Thread.CurrentThread.ManagedThreadId;
            var task = Task.Run(() => _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "worker", Text = "From a worker" }, PlaybackMode.Manual, CancellationToken.None));
            for (var frame = 0; frame < 120 && !_presenter.HasPendingInteraction; frame++) yield return null;
            Assert.IsTrue(_presenter.HasPendingInteraction);
            Assert.AreEqual(mainThread, callbackThread);
            _presenter.RevealText();
            _presenter.Advance();
            yield return Await(task);
        }

        [UnityTest]
        public IEnumerator DisablingObjectCancelsPresentation()
        {
            var task = _presenter.PresentDialogueAsync(new DialogueRequest { RequestId = "line", Text = "Waiting" }, PlaybackMode.Manual, CancellationToken.None);
            _object.SetActive(false);
            yield return WaitUntilComplete(task);
            Assert.IsTrue(task.IsCanceled);
            Assert.IsFalse(_presenter.HasPendingInteraction);
        }

        [UnityTest]
        public IEnumerator DisabledObjectRejectsWorkerRequestAndCanBeReenabled()
        {
            _object.SetActive(false);
            var disabled = Task.Run(() => _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "disabled", Text = "Hidden" }, PlaybackMode.Manual, CancellationToken.None));
            yield return WaitUntilComplete(disabled);
            Assert.IsTrue(disabled.IsCanceled);
            _object.SetActive(true);
            var enabled = _presenter.PresentNarrationAsync(new NarrationRequest { RequestId = "enabled", Text = "Visible" }, PlaybackMode.Manual, CancellationToken.None);
            _presenter.RevealText();
            _presenter.Advance();
            yield return Await(enabled);
        }

        [UnityTest]
        public IEnumerator WorkerRequestsRacingDestructionFinishAndLateCallsCancel()
        {
            var dispatcher = _presenter.Dispatcher;
            var requests = new Task<bool>[32];
            using (var start = new ManualResetEventSlim(false))
            {
                for (var index = 0; index < requests.Length; index++)
                    requests[index] = Task.Run(async () => { start.Wait(); return await dispatcher.InvokeAsync(_ => Task.FromResult(true)); });
                start.Set();
                UnityEngine.Object.DestroyImmediate(_object);
                var all = Task.WhenAll(requests);
                yield return WaitUntilComplete(all);
                Assert.IsFalse(all.IsFaulted, "Destroying the dispatcher must cancel requests rather than fault with a disposed token source.");
                var late = Task.Run(() => dispatcher.InvokeAsync(_ => Task.FromResult(true)));
                yield return WaitUntilComplete(late);
                Assert.IsTrue(late.IsCanceled);
            }
        }

        private static IEnumerator WaitUntilComplete(Task task)
        {
            for (var frame = 0; frame < 120 && !task.IsCompleted; frame++) yield return null;
            Assert.IsTrue(task.IsCompleted, "Interaction did not finish within 120 frames.");
        }

        private static IEnumerator Await(Task task)
        {
            yield return WaitUntilComplete(task);
            if (task.IsFaulted) throw task.Exception.InnerException;
            Assert.IsFalse(task.IsCanceled);
        }
    }
}
