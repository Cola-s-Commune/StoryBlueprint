#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "StoryBlueprintTypes.h"
#include "StoryBlueprintPresenter.generated.h"

class UStoryBlueprintHostComponent;

/** Optional presentation component. Implement in C++ or subclass in Blueprint/UMG. */
UCLASS(Blueprintable, ClassGroup=(StoryBlueprint), meta=(BlueprintSpawnableComponent))
class STORYBLUEPRINT_API UStoryBlueprintPresenter : public UActorComponent
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintPure, Category="Story Blueprint")
    UStoryBlueprintHostComponent* GetStoryHost() const;

    UFUNCTION(BlueprintNativeEvent, Category="Story Blueprint")
    void PresentDialogue(const FStoryBlueprintDialogueRequest& Request);
    virtual void PresentDialogue_Implementation(const FStoryBlueprintDialogueRequest& Request);

    UFUNCTION(BlueprintNativeEvent, Category="Story Blueprint")
    void PresentChoice(const FStoryBlueprintChoiceRequest& Request);
    virtual void PresentChoice_Implementation(const FStoryBlueprintChoiceRequest& Request);

    UFUNCTION(BlueprintNativeEvent, Category="Story Blueprint")
    void ClearPresentation();
    virtual void ClearPresentation_Implementation();
};
