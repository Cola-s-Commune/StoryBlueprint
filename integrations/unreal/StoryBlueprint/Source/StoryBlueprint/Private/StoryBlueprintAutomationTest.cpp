#include "StoryBlueprintSubsystem.h"
#include "Engine/GameInstance.h"

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
    TestFalse(TEXT("wrong signal payload ignored"),
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
#endif
