#include "StoryBlueprintDemo.h"
#include "StoryBlueprintSubsystem.h"
#include "Components/InputComponent.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "InputCoreTypes.h"
#include "Misc/Paths.h"

AStoryBlueprintDemoGameMode::AStoryBlueprintDemoGameMode()
{
    PlayerControllerClass = AStoryBlueprintDemoController::StaticClass();
}

void AStoryBlueprintDemoController::BeginPlay()
{
    Super::BeginPlay();
    UStoryBlueprintSubsystem* Story = GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>();
    const FString File = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("StoryBlueprint"), TEXT("sample-quest.storyc.json"));
    if (Story->LoadStory(File)) Story->StartStory();
}

void AStoryBlueprintDemoController::SetupInputComponent()
{
    Super::SetupInputComponent();
    InputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &AStoryBlueprintDemoController::ContinueStory);
    InputComponent->BindKey(EKeys::One, IE_Pressed, this, &AStoryBlueprintDemoController::ChooseFirst);
    InputComponent->BindKey(EKeys::Two, IE_Pressed, this, &AStoryBlueprintDemoController::ChooseSecond);
    InputComponent->BindKey(EKeys::K, IE_Pressed, this, &AStoryBlueprintDemoController::DefeatDragon);
    InputComponent->BindKey(EKeys::R, IE_Pressed, this, &AStoryBlueprintDemoController::RestartStory);
}

void AStoryBlueprintDemoController::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    UStoryBlueprintSubsystem* Story = GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>();
    if (Story->GetPhase() == EStoryBlueprintPhase::Event && Story->GetPendingEventId() == TEXT("ev_grant_reward"))
    {
        UE_LOG(LogTemp, Display, TEXT("Story Blueprint demo: grant 500 gold"));
        Story->CompleteEvent(TEXT("{\"evo_success\":true}"));
    }
    if (!GEngine) return;
    FString Display = TEXT("Story Blueprint demo | Space: continue | 1/2: choice | K: defeat dragon | R: restart\n");
    Display += Story->GetMessage();
    const TArray<FString> Choices = Story->GetChoiceLabels();
    for (int32 Index = 0; Index < Choices.Num(); ++Index)
        Display += FString::Printf(TEXT("\n%d. %s"), Index + 1, *Choices[Index]);
    GEngine->AddOnScreenDebugMessage(71623, 0.1f, Story->GetPhase() == EStoryBlueprintPhase::Failed ? FColor::Red : FColor::Yellow, Display);
}

void AStoryBlueprintDemoController::ContinueStory()
{
    GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>()->Advance();
}

void AStoryBlueprintDemoController::ChooseFirst()
{
    GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>()->ChooseOption(0);
}

void AStoryBlueprintDemoController::ChooseSecond()
{
    GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>()->ChooseOption(1);
}

void AStoryBlueprintDemoController::DefeatDragon()
{
    GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>()->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}"));
}

void AStoryBlueprintDemoController::RestartStory()
{
    GetGameInstance()->GetSubsystem<UStoryBlueprintSubsystem>()->StartStory();
}
