#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "StoryBlueprintRuntime.h"
#include "StoryBlueprintSubsystem.generated.h"

/** UE access point for the engine-independent executor. Hosts provide presentation and game bindings. */
UCLASS()
class STORYBLUEPRINT_API UStoryBlueprintSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool LoadStory(const FString& AbsolutePath);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool LoadStoryById(const FString& AbsolutePath, const FString& EntryStoryId);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool StartStory();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool Advance();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool ChooseOption(int32 Index);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool SendSignal(const FString& SignalId, const FString& PayloadJson);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool CompleteEvent(const FString& ResultJson);

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    EStoryBlueprintPhase GetPhase() const { return Runtime.GetPhase(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetMessage() const { return Runtime.GetMessage(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetChoiceLabels() const { return Runtime.GetChoiceLabels(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetChoiceIds() const { return Runtime.GetChoiceIds(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FStoryBlueprintChoice> GetChoices() const { return Runtime.GetChoiceRequest().Options; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetSelectedStoryId() const { return Runtime.GetSelectedStoryId(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetAvailableStoryIds() const { return Runtime.GetAvailableStoryIds(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetSpeakerId() const { return Runtime.GetSpeakerId(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingEventId() const { return Runtime.GetPendingEventId(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingEventArgumentsJson() const { return Runtime.GetPendingEventArgumentsJson(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingRequestId() const { return Runtime.GetPendingRequestId(); }

    uint64 GetInteractionSequence() const { return Runtime.GetInteractionSequence(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetLastError() const { return Runtime.GetLastError(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingSignalMatchesJson() const { return Runtime.GetPendingSignalMatchesJson(); }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetDebugSnapshotJson() const { return Runtime.GetDebugSnapshotJson(); }

private:
    FStoryBlueprintRuntime Runtime;
};
