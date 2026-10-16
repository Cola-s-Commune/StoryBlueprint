#include "StoryBlueprintPresenter.h"
#include "StoryBlueprintHostComponent.h"
#include "GameFramework/Actor.h"

UStoryBlueprintHostComponent* UStoryBlueprintPresenter::GetStoryHost() const
{
    return GetOwner() ? GetOwner()->FindComponentByClass<UStoryBlueprintHostComponent>() : nullptr;
}

void UStoryBlueprintPresenter::PresentDialogue_Implementation(const FStoryBlueprintDialogueRequest& Request) {}
void UStoryBlueprintPresenter::PresentChoice_Implementation(const FStoryBlueprintChoiceRequest& Request) {}
void UStoryBlueprintPresenter::ClearPresentation_Implementation() {}
