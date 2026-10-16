#include "StoryBlueprintDemoGame.h"
#include "StoryBlueprintAdapter.h"
#include "Components/InputComponent.h"
#include "Engine/Engine.h"
#include "InputCoreTypes.h"

void UStoryDemoHostComponent::ConfigureAdapter(UStoryBlueprintAdapter* InAdapter)
{
    InAdapter->RegisterEvent(TEXT("ev_grant_reward"),
        [](const FStoryBlueprintEventRequest& Request, FString& ResultJson)
        {
            UE_LOG(LogTemp, Display, TEXT("Story Blueprint demo: grant 500 gold; args=%s"), *Request.ArgumentsJson);
            ResultJson = TEXT("{\"evo_success\":true}");
            return true;
        });
}

void UStoryDemoPresenter::PresentDialogue_Implementation(const FStoryBlueprintDialogueRequest& Request)
{
    DisplayText = Request.SpeakerId.IsEmpty() ? Request.Text : Request.SpeakerId + TEXT(": ") + Request.Text;
    CompletionId = Request.CompletionId;
}

void UStoryDemoPresenter::PresentChoice_Implementation(const FStoryBlueprintChoiceRequest& Request)
{
    DisplayText = Request.Prompt;
    CompletionId = Request.CompletionId;
    OptionLabels.Empty();
    OptionIds.Empty();
    for (const FStoryBlueprintChoice& Option : Request.Options)
    {
        OptionLabels.Add(Option.Text + (Option.bEnabled ? TEXT("") : TEXT(" [Unavailable]")));
        OptionIds.Add(Option.Id);
    }
}

void UStoryDemoPresenter::ClearPresentation_Implementation()
{
    DisplayText.Empty();
    OptionLabels.Empty();
    OptionIds.Empty();
    CompletionId.Empty();
}

AStoryDemoController::AStoryDemoController()
{
    Host = CreateDefaultSubobject<UStoryDemoHostComponent>(TEXT("StoryHost"));
    Presenter = CreateDefaultSubobject<UStoryDemoPresenter>(TEXT("StoryPresenter"));
}

void AStoryDemoController::SetupInputComponent()
{
    Super::SetupInputComponent();
    InputComponent->BindKey(EKeys::SpaceBar, IE_Pressed, this, &AStoryDemoController::ContinueStory);
    InputComponent->BindKey(EKeys::One, IE_Pressed, this, &AStoryDemoController::ChooseFirst);
    InputComponent->BindKey(EKeys::Two, IE_Pressed, this, &AStoryDemoController::ChooseSecond);
    InputComponent->BindKey(EKeys::K, IE_Pressed, this, &AStoryDemoController::DefeatDragon);
    InputComponent->BindKey(EKeys::R, IE_Pressed, this, &AStoryDemoController::RestartStory);
}

void AStoryDemoController::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (!GEngine) return;
    FString Display = TEXT("Story Blueprint demo | Space: continue | 1/2: choice | K: defeat dragon | R: restart\n");
    Display += Presenter->GetDisplayText();
    const TArray<FString>& Options = Presenter->GetOptions();
    for (int32 Index = 0; Index < Options.Num(); ++Index)
        Display += FString::Printf(TEXT("\n%d. %s"), Index + 1, *Options[Index]);
    if (Host->GetPhase() == EStoryBlueprintPhase::Signal) Display += TEXT("\nWaiting for dragon signal: press K");
    if (Host->GetPhase() == EStoryBlueprintPhase::Completed) Display += TEXT("\nStory completed");
    if (Host->GetPhase() == EStoryBlueprintPhase::Failed) Display += TEXT("\n") + Host->GetLastError();
    GEngine->AddOnScreenDebugMessage(71623, 0.1f,
        Host->GetPhase() == EStoryBlueprintPhase::Failed ? FColor::Red : FColor::Yellow, Display);
}

void AStoryDemoController::ContinueStory() { Host->CompleteDialogue(Presenter->GetCompletionId()); }
void AStoryDemoController::ChooseFirst()
{
    if (Presenter->GetOptionIds().IsValidIndex(0))
        Host->CompleteChoice(Presenter->GetCompletionId(), Presenter->GetOptionIds()[0]);
}
void AStoryDemoController::ChooseSecond()
{
    if (Presenter->GetOptionIds().IsValidIndex(1))
        Host->CompleteChoice(Presenter->GetCompletionId(), Presenter->GetOptionIds()[1]);
}
void AStoryDemoController::DefeatDragon()
{
    Host->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}"));
}
void AStoryDemoController::RestartStory() { Host->PlayStory(); }

AStoryDemoGameMode::AStoryDemoGameMode()
{
    PlayerControllerClass = AStoryDemoController::StaticClass();
}
