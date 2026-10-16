#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "Templates/Function.h"
#include "StoryBlueprintTypes.h"
#include "StoryBlueprintAdapter.generated.h"

/** Maps stable story event IDs to game callbacks. Unbound events remain pending for the Host. */
UCLASS(BlueprintType)
class STORYBLUEPRINT_API UStoryBlueprintAdapter : public UObject
{
    GENERATED_BODY()

public:
    using FEventHandler = TFunction<bool(const FStoryBlueprintEventRequest&, FString&)>;

    void RegisterEvent(const FString& EventId, FEventHandler Handler);
    bool TryHandleEvent(const FStoryBlueprintEventRequest& Request, FString& ResultJson) const;

private:
    TMap<FString, FEventHandler> EventHandlers;
};
