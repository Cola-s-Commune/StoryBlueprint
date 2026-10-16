#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Dom/JsonObject.h"
#include "StoryBlueprintSubsystem.generated.h"

UENUM(BlueprintType)
enum class EStoryBlueprintPhase : uint8
{
    Idle, Dialogue, Choice, Signal, Event, Completed, Failed
};

/** A small native executor for standalone story-runtime@7 files. */
UCLASS()
class STORYBLUEPRINT_API UStoryBlueprintSubsystem : public UGameInstanceSubsystem
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool LoadStory(const FString& AbsolutePath);

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool StartStory();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool Advance();

    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool ChooseOption(int32 Index);

    /** Payload is a JSON object, for example {"bossId":"red_dragon"}. */
    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool SendSignal(const FString& SignalId, const FString& PayloadJson);

    /** Result keys must be stable output IDs, for example {"evo_success":true}. */
    UFUNCTION(BlueprintCallable, Category="Story Blueprint")
    bool CompleteEvent(const FString& ResultJson);

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    EStoryBlueprintPhase GetPhase() const { return Phase; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetMessage() const { return Message; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    TArray<FString> GetChoiceLabels() const { return ChoiceLabels; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingEventId() const { return PendingEventId; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetPendingEventArgumentsJson() const { return PendingEventArgumentsJson; }

    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    FString GetLastError() const { return LastError; }

private:
    bool ValidateProgram();
    bool ValidateExpression(const TSharedPtr<FJsonObject>& Expression) const;
    bool ValidateText(const TSharedPtr<FJsonObject>& Text) const;
    bool RunUntilPause();
    bool Fail(const FString& Error);
    TSharedPtr<FJsonValue> Evaluate(const TSharedPtr<FJsonObject>& Expression);
    FString RenderText(const TSharedPtr<FJsonObject>& Text);
    bool MoveTo(const FString& TargetBlock);
    TSharedPtr<FJsonObject> CurrentInstruction() const;

    TSharedPtr<FJsonObject> Program;
    TSharedPtr<FJsonObject> Blocks;
    TMap<FString, TSharedPtr<FJsonValue>> Variables;
    TSharedPtr<FJsonObject> PendingInstruction;
    FString BlockId;
    int32 InstructionIndex = 0;
    EStoryBlueprintPhase Phase = EStoryBlueprintPhase::Idle;
    FString Message;
    FString LastError;
    FString PendingEventId;
    FString PendingEventArgumentsJson;
    TArray<FString> ChoiceLabels;
    TArray<FString> ChoiceTargets;
};
