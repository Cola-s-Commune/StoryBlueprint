#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "StoryBlueprintRuntime.h"
#include "StoryBlueprintTypes.h"
#include "StoryBlueprintHostComponent.generated.h"

class UStoryBlueprintAdapter;
class UStoryBlueprintPresenter;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStoryDialogueDelegate, const FStoryBlueprintDialogueRequest&, Request);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStoryChoiceDelegate, const FStoryBlueprintChoiceRequest&, Request);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStoryEventDelegate, const FStoryBlueprintEventRequest&, Request);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStorySignalDelegate, const FString&, SignalId);
DECLARE_DYNAMIC_MULTICAST_DELEGATE(FStoryCompletedDelegate);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FStoryFailedDelegate, const FString&, Error);

/** Owns one independent story instance and routes interactions to a presenter and game code. */
UCLASS(Blueprintable, ClassGroup=(StoryBlueprint), meta=(BlueprintSpawnableComponent))
class STORYBLUEPRINT_API UStoryBlueprintHostComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    UStoryBlueprintHostComponent();

    /** Path relative to Project/Content. The sample is an ordinary JSON file. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Story Blueprint")
    FString StoryRelativePath = TEXT("StoryBlueprint/sample-quest.storyc.json");

    /** Empty selects the project's entryStoryId; standalone files use their program ID. */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Story Blueprint")
    FString EntryStoryId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category="Story Blueprint")
    bool bPlayOnBeginPlay = true;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryDialogueDelegate OnDialogue;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryChoiceDelegate OnChoice;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStorySignalDelegate OnSignalRequested;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryEventDelegate OnEventRequested;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryCompletedDelegate OnCompleted;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryCompletedDelegate OnStopped;

    UPROPERTY(BlueprintAssignable, Category="Story Blueprint")
    FStoryFailedDelegate OnFailed;

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool PlayStory();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool Advance();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool CompleteDialogue(const FString& CompletionId);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool CompleteChoice(const FString& CompletionId, const FString& OptionId);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool ChooseOption(int32 Index);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool ChooseOptionById(const FString& OptionId);

    /** True means accepted, including buffering during another interaction. Call after PlayStory. */
    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool SendSignal(const FString& SignalId, const FString& PayloadJson);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool CompleteEvent(const FString& CompletionId, const FString& ResultJson);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    void StopStory();

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    EStoryBlueprintPhase GetPhase() const { return Runtime.GetPhase(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetMessage() const { return Runtime.GetMessage(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetChoiceLabels() const { return Runtime.GetChoiceLabels(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FStoryBlueprintChoice> GetChoices() const { return Runtime.GetChoiceRequest().Options; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetSelectedStoryId() const { return Runtime.GetSelectedStoryId(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetAvailableStoryIds() const { return Runtime.GetAvailableStoryIds(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetLastError() const { return Runtime.GetLastError(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FStoryBlueprintEventRequest GetPendingEventRequest() const { return PendingEventRequest; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    UStoryBlueprintAdapter* GetAdapter() const;

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPresentationCompletionId() const { return ActivePresentationCompletionId; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingSignalMatchesJson() const { return Runtime.GetPendingSignalMatchesJson(); }

    /** Diagnostic inspection only; not a save-game contract. */
    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetDebugSnapshotJson() const { return Runtime.GetDebugSnapshotJson(); }

    /** C++ hosts override this to register game callbacks by stable event ID. */
    virtual void ConfigureAdapter(UStoryBlueprintAdapter* InAdapter) {}

protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

private:
    void EnsureBindings();
    bool AfterStep(bool bResult);
    void PresentCurrentInteraction();

    UPROPERTY(Transient)
    TObjectPtr<UStoryBlueprintAdapter> Adapter;

    UPROPERTY(Transient)
    TObjectPtr<UStoryBlueprintPresenter> Presenter;

    FStoryBlueprintRuntime Runtime;
    uint64 LastPresentedSequence = 0;
    bool bFailureReported = false;
    FString ActiveEventCompletionId;
    FString ActivePresentationCompletionId;
    FStoryBlueprintEventRequest PendingEventRequest;
    bool bEndingPlay = false;
    uint64 RunGeneration = 0;
};
