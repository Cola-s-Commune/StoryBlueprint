#include "StoryBlueprintSubsystem.h"
#include "Engine/GameInstance.h"
#include "StoryBlueprintHostComponent.h"
#include "StoryBlueprintAdapter.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"
#include "Misc/Paths.h"

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintSampleQuestTest,
    "StoryBlueprint.SampleQuest", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintSampleQuestTest::RunTest(const FString& Parameters)
{
    UGameInstance* Instance = NewObject<UGameInstance>(GetTransientPackage());
    UStoryBlueprintSubsystem* Story = NewObject<UStoryBlueprintSubsystem>(Instance);
    const FString File = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("StoryBlueprint"), TEXT("sample-quest.storyc.json"));
    if (!TestTrue(TEXT("load sample"), Story->LoadStory(File)))
    {
        AddError(Story->GetLastError());
        return false;
    }
    if (!TestTrue(TEXT("start story"), Story->StartStory())) return false;
    TestEqual(TEXT("initial dialogue"), Story->GetPhase(), EStoryBlueprintPhase::Dialogue);
    TestTrue(TEXT("interpolated player name"), Story->GetMessage().Contains(TEXT("Hero")));
    if (!TestTrue(TEXT("advance"), Story->Advance())) return false;
    TestEqual(TEXT("choice"), Story->GetPhase(), EStoryBlueprintPhase::Choice);
    TestEqual(TEXT("two choices"), Story->GetChoiceLabels().Num(), 2);
    if (!TestTrue(TEXT("accept quest"), Story->ChooseOption(0))) return false;
    TestEqual(TEXT("wait for dragon"), Story->GetPhase(), EStoryBlueprintPhase::Signal);
    TestTrue(TEXT("nonmatching signal payload accepted into inbox"),
        Story->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"other\"}")));
    TestEqual(TEXT("still waiting"), Story->GetPhase(), EStoryBlueprintPhase::Signal);
    if (!TestTrue(TEXT("matching signal"),
        Story->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}")))) return false;
    TestEqual(TEXT("event"), Story->GetPhase(), EStoryBlueprintPhase::Event);
    TestEqual(TEXT("stable event ID"), Story->GetPendingEventId(), FString(TEXT("ev_grant_reward")));
    TestTrue(TEXT("evaluated event arguments"), Story->GetPendingEventArgumentsJson().Contains(TEXT("500")));
    if (!TestTrue(TEXT("complete event"), Story->CompleteEvent(TEXT("{\"evo_success\":true}")))) return false;
    TestEqual(TEXT("accepted path complete"), Story->GetPhase(), EStoryBlueprintPhase::Completed);
    if (!TestTrue(TEXT("restart"), Story->StartStory())) return false;
    if (!TestTrue(TEXT("advance on restart"), Story->Advance())) return false;
    if (!TestTrue(TEXT("decline quest"), Story->ChooseOption(1))) return false;
    TestEqual(TEXT("declined path complete"), Story->GetPhase(), EStoryBlueprintPhase::Completed);
    return true;
}
IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintHostLifecycleTest,
    "StoryBlueprint.HostLifecycle", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintHostLifecycleTest::RunTest(const FString& Parameters)
{
    UStoryBlueprintHostComponent* First = NewObject<UStoryBlueprintHostComponent>(GetTransientPackage());
    UStoryBlueprintHostComponent* Second = NewObject<UStoryBlueprintHostComponent>(GetTransientPackage());
    if (!TestTrue(TEXT("first host starts"), First->PlayStory())) return false;
    if (!TestTrue(TEXT("second host starts"), Second->PlayStory())) return false;
    const FString OldDialogueCompletion = First->GetPresentationCompletionId();
    if (!First->CompleteDialogue(OldDialogueCompletion)) return false;
    TestFalse(TEXT("dialogue completion cannot complete a choice"), First->CompleteDialogue(OldDialogueCompletion));
    const FString ChoiceCompletion = First->GetPresentationCompletionId();
    TestFalse(TEXT("unknown choice ID rejected"), First->CompleteChoice(ChoiceCompletion, TEXT("missing")));
    if (!First->CompleteChoice(ChoiceCompletion, TEXT("opt_accept")) ||
        !First->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}")))
        return false;
    TestEqual(TEXT("second host remains independent"), Second->GetPhase(), EStoryBlueprintPhase::Dialogue);
    const FString OldCompletion = First->GetPendingEventRequest().CompletionId;
    TestFalse(TEXT("event has completion token"), OldCompletion.IsEmpty());
    First->StopStory();
    TestEqual(TEXT("stop clears interaction"), First->GetPhase(), EStoryBlueprintPhase::Idle);
    TestFalse(TEXT("completion after stop rejected"), First->CompleteEvent(OldCompletion, TEXT("{\"evo_success\":true}")));
    if (!First->PlayStory()) return false;
    TestFalse(TEXT("old UI completion cannot advance restarted story"), First->CompleteDialogue(OldDialogueCompletion));
    if (!First->Advance() || !First->ChooseOptionById(TEXT("opt_accept")) ||
        !First->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}")))
        return false;
    const FString NewCompletion = First->GetPendingEventRequest().CompletionId;
    TestTrue(TEXT("restart uses a new completion token"), OldCompletion != NewCompletion);
    TestFalse(TEXT("stale completion cannot advance restarted story"),
        First->CompleteEvent(OldCompletion, TEXT("{\"evo_success\":true}")));
    TestEqual(TEXT("restarted story still waits for its event"), First->GetPhase(), EStoryBlueprintPhase::Event);
    if (!TestTrue(TEXT("current completion accepted"), First->CompleteEvent(NewCompletion, TEXT("{\"evo_success\":true}")))) return false;
    TestEqual(TEXT("first host completed"), First->GetPhase(), EStoryBlueprintPhase::Completed);
    if (!Second->Advance() || !Second->ChooseOptionById(TEXT("opt_decline"))) return false;
    TestEqual(TEXT("second host completes separately"), Second->GetPhase(), EStoryBlueprintPhase::Completed);
    UStoryBlueprintHostComponent* BoundHost = NewObject<UStoryBlueprintHostComponent>(GetTransientPackage());
    if (!BoundHost->PlayStory()) return false;
    bool bGameHandlerCalled = false;
    BoundHost->GetAdapter()->RegisterEvent(TEXT("ev_grant_reward"),
        [&bGameHandlerCalled](const FStoryBlueprintEventRequest& Request, FString& ResultJson)
        {
            bGameHandlerCalled = Request.ArgumentsJson.Contains(TEXT("500"));
            ResultJson = TEXT("{\"evo_success\":true}");
            return true;
        });
    if (!BoundHost->Advance() || !BoundHost->ChooseOptionById(TEXT("opt_accept")) ||
        !BoundHost->SendSignal(TEXT("sig_boss_slain"), TEXT("{\"bossId\":\"red_dragon\"}"))) return false;
    TestTrue(TEXT("registered game handler receives evaluated arguments"), bGameHandlerCalled);
    TestEqual(TEXT("registered callback completes through the Host"), BoundHost->GetPhase(), EStoryBlueprintPhase::Completed);
    return true;
}
#endif
