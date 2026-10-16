#pragma once

#include "CoreMinimal.h"
#include "StoryBlueprintTypes.generated.h"

UENUM(BlueprintType)
enum class EStoryBlueprintPhase : uint8
{
    Idle, Dialogue, Choice, Signal, Event, Completed, Failed
};

USTRUCT(BlueprintType)
struct STORYBLUEPRINT_API FStoryBlueprintChoice
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString Id;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString Text;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString TextId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    bool bEnabled = true;
};

USTRUCT(BlueprintType)
struct STORYBLUEPRINT_API FStoryBlueprintVoiceReference
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString DefaultAssetId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    TMap<FString, FString> Locales;
};

USTRUCT(BlueprintType)
struct STORYBLUEPRINT_API FStoryBlueprintDialogueRequest
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString RequestId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString CompletionId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString Text;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString SpeakerId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString TextId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString PortraitId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString Emotion;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    TArray<FString> Tags;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FStoryBlueprintVoiceReference Voice;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    bool bNarration = false;
};

USTRUCT(BlueprintType)
struct STORYBLUEPRINT_API FStoryBlueprintChoiceRequest
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString RequestId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString CompletionId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString Prompt;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString PromptTextId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    TArray<FStoryBlueprintChoice> Options;
};

USTRUCT(BlueprintType)
struct STORYBLUEPRINT_API FStoryBlueprintEventRequest
{
    GENERATED_BODY()

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString RequestId;

    /** Unique for this occurrence; return it to Host.CompleteEvent after asynchronous work. */
    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString CompletionId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString EventId;

    UPROPERTY(BlueprintReadOnly, Category="Story Blueprint")
    FString ArgumentsJson;
};
