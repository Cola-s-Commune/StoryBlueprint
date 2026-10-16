#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameFramework/PlayerController.h"
#include "StoryBlueprintHostComponent.h"
#include "StoryBlueprintPresenter.h"
#include "StoryBlueprintDemoGame.generated.h"

class UStoryBlueprintAdapter;

/** Project-owned game event bindings. Replace these with actual game services. */
UCLASS(ClassGroup=(StoryBlueprint), meta=(BlueprintSpawnableComponent))
class STORYBLUEPRINTDEMO_API UStoryDemoHostComponent : public UStoryBlueprintHostComponent
{
    GENERATED_BODY()

public:
    virtual void ConfigureAdapter(UStoryBlueprintAdapter* InAdapter) override;
};

/** Minimal replaceable presenter; a UMG Blueprint can subclass UStoryBlueprintPresenter. */
UCLASS(ClassGroup=(StoryBlueprint), meta=(BlueprintSpawnableComponent))
class STORYBLUEPRINTDEMO_API UStoryDemoPresenter : public UStoryBlueprintPresenter
{
    GENERATED_BODY()

public:
    virtual void PresentDialogue_Implementation(const FStoryBlueprintDialogueRequest& Request) override;
    virtual void PresentChoice_Implementation(const FStoryBlueprintChoiceRequest& Request) override;
    virtual void ClearPresentation_Implementation() override;

    const FString& GetDisplayText() const { return DisplayText; }
    const TArray<FString>& GetOptions() const { return OptionLabels; }
    const TArray<FString>& GetOptionIds() const { return OptionIds; }
    const FString& GetCompletionId() const { return CompletionId; }

private:
    FString DisplayText;
    TArray<FString> OptionLabels;
    TArray<FString> OptionIds;
    FString CompletionId;
};

UCLASS()
class STORYBLUEPRINTDEMO_API AStoryDemoController : public APlayerController
{
    GENERATED_BODY()

public:
    AStoryDemoController();
    virtual void SetupInputComponent() override;
    virtual void Tick(float DeltaSeconds) override;

private:
    void ContinueStory();
    void ChooseFirst();
    void ChooseSecond();
    void DefeatDragon();
    void RestartStory();

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UStoryDemoHostComponent> Host;

    UPROPERTY(VisibleAnywhere)
    TObjectPtr<UStoryDemoPresenter> Presenter;
};

UCLASS()
class STORYBLUEPRINTDEMO_API AStoryDemoGameMode : public AGameModeBase
{
    GENERATED_BODY()

public:
    AStoryDemoGameMode();
};
