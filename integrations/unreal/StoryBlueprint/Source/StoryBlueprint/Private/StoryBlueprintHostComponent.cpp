#include "StoryBlueprintHostComponent.h"
#include "StoryBlueprintAdapter.h"
#include "StoryBlueprintPresenter.h"
#include "GameFramework/Actor.h"
#include "Misc/Paths.h"

UStoryBlueprintHostComponent::UStoryBlueprintHostComponent()
{
    PrimaryComponentTick.bCanEverTick = false;
}

UStoryBlueprintAdapter* UStoryBlueprintHostComponent::GetAdapter() const
{
    return Adapter.Get();
}

void UStoryBlueprintHostComponent::BeginPlay()
{
    Super::BeginPlay();
    bEndingPlay = false;
    EnsureBindings();
    if (bPlayOnBeginPlay) PlayStory();
}

void UStoryBlueprintHostComponent::EnsureBindings()
{
    if (!Adapter)
    {
        Adapter = NewObject<UStoryBlueprintAdapter>(this);
        ConfigureAdapter(Adapter);
    }
    if (!Presenter && GetOwner()) Presenter = GetOwner()->FindComponentByClass<UStoryBlueprintPresenter>();
}

void UStoryBlueprintHostComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    bEndingPlay = true;
    StopStory();
    Super::EndPlay(EndPlayReason);
}

bool UStoryBlueprintHostComponent::PlayStory()
{
    if (bEndingPlay) return false;
    const bool bHadStory = Runtime.GetPhase() != EStoryBlueprintPhase::Idle;
    ++RunGeneration;
    const uint64 StartingGeneration = RunGeneration;
    EnsureBindings();
    LastPresentedSequence = 0;
    bFailureReported = false;
    ActiveEventCompletionId.Empty();
    ActivePresentationCompletionId.Empty();
    PendingEventRequest = FStoryBlueprintEventRequest();
    Runtime = FStoryBlueprintRuntime();
    if (bHadStory) OnStopped.Broadcast();
    if (bEndingPlay || RunGeneration != StartingGeneration) return false;
    if (Presenter) Presenter->ClearPresentation();
    if (bEndingPlay || RunGeneration != StartingGeneration) return false;
    const FString File = FPaths::Combine(FPaths::ProjectContentDir(), StoryRelativePath);
    if (!Runtime.LoadStory(File, EntryStoryId)) return AfterStep(false);
    return AfterStep(Runtime.StartStory());
}

bool UStoryBlueprintHostComponent::Advance()
{
    if (Runtime.GetPhase() == EStoryBlueprintPhase::Dialogue) ActivePresentationCompletionId.Empty();
    return AfterStep(Runtime.Advance());
}

bool UStoryBlueprintHostComponent::CompleteDialogue(const FString& CompletionId)
{
    if (CompletionId.IsEmpty() || CompletionId != ActivePresentationCompletionId ||
        Runtime.GetPhase() != EStoryBlueprintPhase::Dialogue) return false;
    return Advance();
}

bool UStoryBlueprintHostComponent::CompleteChoice(const FString& CompletionId, const FString& OptionId)
{
    if (CompletionId.IsEmpty() || CompletionId != ActivePresentationCompletionId ||
        Runtime.GetPhase() != EStoryBlueprintPhase::Choice) return false;
    return ChooseOptionById(OptionId);
}

bool UStoryBlueprintHostComponent::ChooseOption(int32 Index)
{
    if (Runtime.CanChooseOption(Index))
        ActivePresentationCompletionId.Empty();
    return AfterStep(Runtime.ChooseOption(Index));
}

bool UStoryBlueprintHostComponent::ChooseOptionById(const FString& OptionId)
{
    return ChooseOption(Runtime.GetChoiceIds().IndexOfByKey(OptionId));
}

bool UStoryBlueprintHostComponent::SendSignal(const FString& SignalId, const FString& PayloadJson)
{
    return AfterStep(Runtime.SendSignal(SignalId, PayloadJson));
}

bool UStoryBlueprintHostComponent::CompleteEvent(const FString& CompletionId, const FString& ResultJson)
{
    if (CompletionId.IsEmpty() || CompletionId != ActiveEventCompletionId ||
        Runtime.GetPhase() != EStoryBlueprintPhase::Event) return false;
    ActiveEventCompletionId.Empty();
    PendingEventRequest = FStoryBlueprintEventRequest();
    return AfterStep(Runtime.CompleteEvent(ResultJson));
}

void UStoryBlueprintHostComponent::StopStory()
{
    ++RunGeneration;
    const uint64 StoppedGeneration = RunGeneration;
    Runtime = FStoryBlueprintRuntime();
    LastPresentedSequence = 0;
    bFailureReported = false;
    ActiveEventCompletionId.Empty();
    ActivePresentationCompletionId.Empty();
    PendingEventRequest = FStoryBlueprintEventRequest();
    OnStopped.Broadcast();
    if (RunGeneration == StoppedGeneration && Presenter) Presenter->ClearPresentation();
}

bool UStoryBlueprintHostComponent::AfterStep(bool bResult)
{
    if (Runtime.GetPhase() == EStoryBlueprintPhase::Failed)
    {
        if (!bFailureReported)
        {
            bFailureReported = true;
            ActiveEventCompletionId.Empty();
            ActivePresentationCompletionId.Empty();
            PendingEventRequest = FStoryBlueprintEventRequest();
            const FString Error = Runtime.GetLastError();
            const uint64 FailedGeneration = RunGeneration;
            if (Presenter) Presenter->ClearPresentation();
            if (RunGeneration == FailedGeneration) OnFailed.Broadcast(Error);
        }
        return false;
    }
    if (bResult) PresentCurrentInteraction();
    return bResult && Runtime.GetPhase() != EStoryBlueprintPhase::Failed;
}

void UStoryBlueprintHostComponent::PresentCurrentInteraction()
{
    // Registered C++ handlers may complete an event immediately and reveal another interaction.
    for (int32 Dispatches = 0; Dispatches < 32; ++Dispatches)
    {
        const uint64 Sequence = Runtime.GetInteractionSequence();
        const uint64 Generation = RunGeneration;
        if (Sequence == LastPresentedSequence) return;
        LastPresentedSequence = Sequence;
        ActivePresentationCompletionId.Empty();
        if (Presenter) Presenter->ClearPresentation();
        if (RunGeneration != Generation || Runtime.GetInteractionSequence() != Sequence) return;
        switch (Runtime.GetPhase())
        {
        case EStoryBlueprintPhase::Dialogue:
        {
            FStoryBlueprintDialogueRequest Request = Runtime.GetDialogueRequest();
            Request.CompletionId = FGuid::NewGuid().ToString();
            ActivePresentationCompletionId = Request.CompletionId;
            if (Presenter) Presenter->PresentDialogue(Request);
            if (RunGeneration == Generation && ActivePresentationCompletionId == Request.CompletionId)
                OnDialogue.Broadcast(Request);
            return;
        }
        case EStoryBlueprintPhase::Choice:
        {
            FStoryBlueprintChoiceRequest Request = Runtime.GetChoiceRequest();
            Request.CompletionId = FGuid::NewGuid().ToString();
            ActivePresentationCompletionId = Request.CompletionId;
            if (Presenter) Presenter->PresentChoice(Request);
            if (RunGeneration == Generation && ActivePresentationCompletionId == Request.CompletionId)
                OnChoice.Broadcast(Request);
            return;
        }
        case EStoryBlueprintPhase::Signal:
            OnSignalRequested.Broadcast(Runtime.GetPendingSignalId());
            return;
        case EStoryBlueprintPhase::Event:
        {
            FStoryBlueprintEventRequest Request;
            Request.RequestId = Runtime.GetPendingRequestId();
            Request.CompletionId = FGuid::NewGuid().ToString();
            Request.EventId = Runtime.GetPendingEventId();
            Request.ArgumentsJson = Runtime.GetPendingEventArgumentsJson();
            FString ResultJson;
            const bool bHandled = Adapter && Adapter->TryHandleEvent(Request, ResultJson);
            if (RunGeneration != Generation || Runtime.GetInteractionSequence() != Sequence) return;
            if (bHandled)
            {
                if (!Runtime.CompleteEvent(ResultJson))
                {
                    AfterStep(false);
                    return;
                }
                continue;
            }
            ActiveEventCompletionId = Request.CompletionId;
            PendingEventRequest = Request;
            OnEventRequested.Broadcast(Request);
            return;
        }
        case EStoryBlueprintPhase::Completed:
            OnCompleted.Broadcast();
            return;
        default:
            return;
        }
    }
    Runtime.ReportAdapterFailure(TEXT("Too many immediate event dispatches"));
    AfterStep(false);
}
