#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "StoryBlueprintTypes.h"
#include "StoryBlueprintProject.h"

/** Story execution with no World, Actor, input, UI, or GameInstance dependency. */
class STORYBLUEPRINT_API FStoryBlueprintRuntime
{
public:
    bool LoadStory(const FString& AbsolutePath, const FString& StoryId = FString());
    bool LoadStoryJson(const FString& Json, const FString& StoryId = FString());
    bool StartStory();
    bool Advance();
    bool ChooseOption(int32 Index);
    /** True means accepted (possibly buffered); inspect phase to determine progress. */
    bool SendSignal(const FString& SignalId, const FString& PayloadJson);
    bool CompleteEvent(const FString& ResultJson);
    bool ReportAdapterFailure(const FString& Error) { return Fail(Error); }

    EStoryBlueprintPhase GetPhase() const { return Phase; }
    const FString& GetMessage() const { return Message; }
    const TArray<FString>& GetChoiceLabels() const { return ChoiceLabels; }
    const TArray<FString>& GetChoiceIds() const { return ChoiceIds; }
    bool CanChooseOption(int32 Index) const;
    const FString& GetSelectedStoryId() const { return Artifact.SelectedStoryId; }
    const TArray<FString>& GetAvailableStoryIds() const { return Artifact.StoryIds; }
    const FString& GetSpeakerId() const { return SpeakerId; }
    const FString& GetPendingEventId() const { return PendingEventId; }
    FString GetPendingSignalId() const;
    const FString& GetPendingEventArgumentsJson() const { return PendingEventArgumentsJson; }
    FString GetPendingRequestId() const;
    FStoryBlueprintDialogueRequest GetDialogueRequest() const;
    FStoryBlueprintChoiceRequest GetChoiceRequest() const;
    FString GetPendingSignalMatchesJson() const;
    /** Inspection only; not a versioned save/restore format. */
    FString GetDebugSnapshotJson() const;
    uint64 GetInteractionSequence() const { return InteractionSequence; }
    const FString& GetLastError() const { return LastError; }

private:
    bool IndexProgram();
    bool ValidateOutputReference(const FString& Kind, const FString& InstructionId,
        const FString& OutputId, const TSharedPtr<FJsonObject>& Type) const;
    bool ValidateSignalPayload(const FString& SignalId, const TSharedPtr<FJsonObject>& Payload);
    TSharedPtr<FJsonObject> ConsumeSignal(const FString& SignalId, const TSharedPtr<FJsonObject>& Matches);
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
    FStoryBlueprintArtifact Artifact;
    TSharedPtr<FJsonObject> Blocks;
    TMap<FString, TSharedPtr<FJsonValue>> Variables;
    TMap<FString, TSharedPtr<FJsonObject>> VariableTypes;
    TMap<FString, TSharedPtr<FJsonObject>> InstructionsById;
    TMap<FString, TSharedPtr<FJsonObject>> SignalDefinitions;
    TMap<FString, TSharedPtr<FJsonObject>> EventDefinitions;
    TMap<FString, TSharedPtr<FJsonObject>> EventOutputs;
    TMap<FString, TSharedPtr<FJsonObject>> SignalOutputs;
    TMap<FString, TArray<TSharedPtr<FJsonObject>>> SignalInbox;
    TSharedPtr<FJsonObject> PendingSignalMatches;
    TSharedPtr<FJsonObject> PendingInstruction;
    FString BlockId;
    int32 InstructionIndex = 0;
    EStoryBlueprintPhase Phase = EStoryBlueprintPhase::Idle;
    FString Message;
    FString LastError;
    FString PendingEventId;
    FString PendingEventArgumentsJson;
    FString SpeakerId;
    TArray<FString> ChoiceLabels;
    TArray<FString> ChoiceIds;
    TArray<FString> ChoiceTargets;
    TArray<FString> ChoiceTextIds;
    TArray<bool> ChoiceEnabled;
    uint64 InteractionSequence = 0;
    bool bStarted = false;
};
