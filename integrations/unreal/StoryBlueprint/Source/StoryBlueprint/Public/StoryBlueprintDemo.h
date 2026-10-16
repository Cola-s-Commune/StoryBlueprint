#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/PlayerController.h"
#include "StoryBlueprintDemo.generated.h"

/** Input-only sample so the plugin can be tried without UMG assets. */
UCLASS()
class STORYBLUEPRINT_API AStoryBlueprintDemoController : public APlayerController
{
    GENERATED_BODY()

public:
    virtual void BeginPlay() override;
    virtual void SetupInputComponent() override;
    virtual void Tick(float DeltaSeconds) override;

private:
    void ContinueStory();
    void ChooseFirst();
    void ChooseSecond();
    void DefeatDragon();
    void RestartStory();
};

UCLASS()
class STORYBLUEPRINT_API AStoryBlueprintDemoGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AStoryBlueprintDemoGameMode();
};
