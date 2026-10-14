using System;
using System.Threading;
using System.Threading.Tasks;
using StoryBlueprint.Runtime;
using UnityEngine;

namespace StoryBlueprint.Unity
{
    /// <summary>Presentation state and input hooks for a game-owned UI. Choice always waits for player input.</summary>
    [DisallowMultipleComponent]
    [DefaultExecutionOrder(-90)]
    [RequireComponent(typeof(UnityMainThreadDispatcher))]
    public class UnityStoryPresenter : MonoBehaviour, IStoryPresenter
    {
        [SerializeField] private PlaybackMode playbackMode = PlaybackMode.Manual;
        [SerializeField, Min(0)] private float charactersPerSecond = 36;
        [SerializeField, Min(0)] private float automaticMinimumSeconds = 1.5f;
        [SerializeField, Min(0)] private float automaticSecondsPerCharacter = 0.035f;
        [SerializeField] private bool waitForVoice = true;

        private UnityMainThreadDispatcher _dispatcher;
        private Pending _pending;
        private AudioSource _voice;
        private Texture _portrait;
        private bool _available;
        private bool _destroyed;
        private PlaybackMode? _modeOverride;

        private sealed class Pending
        {
            public string Text;
            public string Speaker;
            public ChoiceRequest Choice;
            public PlaybackMode Mode;
            public float VisibleCharacters;
            public float FullyVisibleAt = -1;
            public readonly TaskCompletionSource<string> Completion = new TaskCompletionSource<string>();
            public CancellationTokenRegistration Registration;
        }

        public UnityMainThreadDispatcher Dispatcher { get { return _dispatcher; } }
        public PlaybackMode PlaybackMode { get { return playbackMode; } set { SetPlaybackMode(value); } }
        public float CharactersPerSecond { get { return charactersPerSecond; } set { charactersPerSecond = Mathf.Max(0, value); } }
        public float AutomaticMinimumSeconds { get { return automaticMinimumSeconds; } set { automaticMinimumSeconds = Mathf.Max(0, value); } }
        public float AutomaticSecondsPerCharacter { get { return automaticSecondsPerCharacter; } set { automaticSecondsPerCharacter = Mathf.Max(0, value); } }
        public bool HasPendingInteraction { get { return _pending != null; } }
        public bool IsChoosing { get { return _pending != null && _pending.Choice != null; } }
        public bool IsTyping { get { return _pending != null && _pending.Choice == null && _pending.VisibleCharacters < _pending.Text.Length; } }
        public string DisplayedText { get { return _pending == null ? "" : _pending.Text.Substring(0, Mathf.Min(_pending.Text.Length, Mathf.FloorToInt(_pending.VisibleCharacters))); } }
        public ChoiceRequest CurrentChoice { get { return _pending == null ? null : _pending.Choice; } }
        public string CurrentSpeaker { get { return _pending == null ? "" : _pending.Speaker; } }
        public Texture CurrentPortrait { get { return _portrait; } }

        // Stable IDs are handed to the game; the package never treats an ID as a Resources path.
        public Func<string, string> SpeakerResolver { get; set; }
        public Func<string, Texture> PortraitResolver { get; set; }
        public Func<string, AudioClip> VoiceResolver { get; set; }
        public event Action<DialogueRequest> DialoguePresented;
        public event Action<NarrationRequest> NarrationPresented;
        public event Action<ChoiceRequest> ChoicePresented;
        public event Action InteractionCleared;

        protected virtual void Awake()
        {
            _dispatcher = GetComponent<UnityMainThreadDispatcher>();
            _voice = GetComponent<AudioSource>();
        }

        protected virtual void OnEnable() { _available = true; }

        public Task PresentDialogueAsync(DialogueRequest request, PlaybackMode mode, CancellationToken cancellationToken)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            return _dispatcher.InvokeAsync(token => Begin(request.Text, request.SpeakerId, null, mode, token, () =>
            {
                _portrait = string.IsNullOrEmpty(request.PortraitId) ? null : PortraitResolver?.Invoke(request.PortraitId);
                PlayVoice(request.VoiceAssetId);
                DialoguePresented?.Invoke(request);
            }), cancellationToken);
        }

        public Task PresentNarrationAsync(NarrationRequest request, PlaybackMode mode, CancellationToken cancellationToken)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            return _dispatcher.InvokeAsync(token => Begin(request.Text, null, null, mode, token, () =>
            {
                PlayVoice(request.VoiceAssetId);
                NarrationPresented?.Invoke(request);
            }), cancellationToken);
        }

        public Task<string> PresentChoiceAsync(ChoiceRequest request, CancellationToken cancellationToken)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            return _dispatcher.InvokeAsync(token => Begin(request.Prompt, null, request, playbackMode, token, () => ChoicePresented?.Invoke(request)), cancellationToken);
        }

        private Task<string> Begin(string text, string speakerId, ChoiceRequest choice, PlaybackMode mode, CancellationToken token, Action notify)
        {
            token.ThrowIfCancellationRequested();
            if (_destroyed || !_available) return Task.FromCanceled<string>(new CancellationToken(true));
            if (_pending != null) throw new InvalidOperationException("This presenter is already displaying an interaction. Use a separate presenter for concurrent stories.");
            if (choice != null)
            {
                var anyEnabled = false;
                foreach (var option in choice.Options) anyEnabled |= option.Enabled;
                if (!anyEnabled) throw new InvalidOperationException("A choice has no enabled options.");
            }
            mode = _modeOverride ?? mode;
            playbackMode = mode;
            var pending = new Pending
            {
                Text = text ?? "",
                Speaker = speakerId == null ? "Narration" : SpeakerResolver?.Invoke(speakerId) ?? speakerId,
                Choice = choice,
                Mode = mode
            };
            if (choice != null || charactersPerSecond <= 0) pending.VisibleCharacters = pending.Text.Length;
            _pending = pending;
            pending.Registration = token.Register(() =>
            {
                pending.Completion.TrySetCanceled();
                _dispatcher.Post(() => Clear(pending));
            });
            try
            {
                if (!pending.Completion.Task.IsCompleted) notify();
            }
            catch (Exception error)
            {
                Clear(pending);
                pending.Completion.TrySetException(error);
            }
            return pending.Completion.Task;
        }

        private void PlayVoice(string assetId)
        {
            if (string.IsNullOrEmpty(assetId) || VoiceResolver == null) return;
            var clip = VoiceResolver(assetId);
            if (clip == null) return;
            if (_voice == null) _voice = gameObject.AddComponent<AudioSource>();
            _voice.playOnAwake = false;
            _voice.clip = clip;
            _voice.Play();
        }

        public void SetPlaybackMode(PlaybackMode mode)
        {
            playbackMode = mode;
            _modeOverride = mode;
            if (_pending != null) _pending.Mode = mode;
        }

        /// <summary>Reveals a typing line first. A second advance completes it.</summary>
        public void Advance()
        {
            if (_pending == null || _pending.Choice != null) return;
            if (IsTyping) { RevealText(); return; }
            var pending = _pending;
            Clear(pending);
            pending.Completion.TrySetResult("");
        }

        public void RevealText()
        {
            if (_pending == null || _pending.Choice != null) return;
            _pending.VisibleCharacters = _pending.Text.Length;
            _pending.FullyVisibleAt = Time.unscaledTime;
        }

        public bool SelectChoice(string optionId)
        {
            var pending = _pending;
            if (pending == null || pending.Choice == null) return false;
            foreach (var option in pending.Choice.Options)
            {
                if (option.Id != optionId || !option.Enabled) continue;
                Clear(pending);
                pending.Completion.TrySetResult(option.Id);
                return true;
            }
            return false;
        }

        public void CancelPresentation()
        {
            var pending = _pending;
            if (pending == null) return;
            Clear(pending);
            pending.Completion.TrySetCanceled();
        }

        private void Clear(Pending pending)
        {
            if (_pending != pending) return;
            _pending = null;
            pending.Registration.Dispose();
            _portrait = null;
            if (_voice != null) _voice.Stop();
            try { InteractionCleared?.Invoke(); }
            catch (Exception error) { Debug.LogException(error, this); }
        }

        protected virtual void Update()
        {
            var pending = _pending;
            if (pending == null || pending.Choice != null) return;
            if (IsTyping) pending.VisibleCharacters = Mathf.Min(pending.Text.Length, pending.VisibleCharacters + Time.unscaledDeltaTime * charactersPerSecond);
            if (!IsTyping && pending.FullyVisibleAt < 0) pending.FullyVisibleAt = Time.unscaledTime;
            if (pending.Mode == PlaybackMode.Automatic && !IsTyping)
            {
                var seconds = Mathf.Max(automaticMinimumSeconds, pending.Text.Length * automaticSecondsPerCharacter);
                if (Time.unscaledTime - pending.FullyVisibleAt >= seconds && (!waitForVoice || _voice == null || !_voice.isPlaying)) Advance();
            }
        }

        protected virtual void OnDisable() { _available = false; CancelPresentation(); }
        protected virtual void OnDestroy() { _destroyed = true; _available = false; CancelPresentation(); }
    }
}
