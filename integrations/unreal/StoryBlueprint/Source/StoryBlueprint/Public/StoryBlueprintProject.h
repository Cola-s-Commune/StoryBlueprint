#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

struct STORYBLUEPRINT_API FStoryBlueprintArtifact
{
    TSharedPtr<FJsonObject> Root;
    TSharedPtr<FJsonObject> Program;
    FString SelectedStoryId;
    TArray<FString> StoryIds;
};

/** Reads standalone programs and compiled-project envelopes without executing them. */
class STORYBLUEPRINT_API FStoryBlueprintProject
{
public:
    static bool Parse(const FString& Json, const FString& RequestedStoryId,
        FStoryBlueprintArtifact& Result, FString& Error);
};
