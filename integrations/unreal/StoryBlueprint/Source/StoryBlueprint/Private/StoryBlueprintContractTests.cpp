#include "StoryBlueprintRuntime.h"
#include "StoryBlueprintProject.h"
#include "StoryBlueprintEvaluator.h"
#include "StoryBlueprintHostComponent.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Dom/JsonValue.h"
#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
FString FixturePath(const TCHAR* Name)
{
    return FPaths::Combine(FPaths::ProjectContentDir(), TEXT("StoryBlueprint/Fixtures"), Name);
}

TSharedPtr<FJsonObject> ReadFixture(const TCHAR* Name)
{
    FString Json;
    TSharedPtr<FJsonObject> Object;
    if (!FFileHelper::LoadFileToString(Json, *FixturePath(Name))) return nullptr;
    if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Json), Object)) return nullptr;
    return Object;
}

FString JsonText(const TSharedPtr<FJsonObject>& Object)
{
    FString Json;
    FJsonSerializer::Serialize(Object.ToSharedRef(), TJsonWriterFactory<>::Create(&Json));
    return Json;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintProjectConditionsTest,
    "StoryBlueprint.ProjectConditions", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintProjectConditionsTest::RunTest(const FString& Parameters)
{
    FStoryBlueprintRuntime Runtime;
    const FString File = FixturePath(TEXT("conditional-project.storyc.json"));
    if (!TestTrue(TEXT("project loads using its default entry"), Runtime.LoadStory(File))) return false;
    TestEqual(TEXT("selected entry"), Runtime.GetSelectedStoryId(), FString(TEXT("s_conditions")));
    TestEqual(TEXT("two available stories"), Runtime.GetAvailableStoryIds().Num(), 2);
    if (!TestTrue(TEXT("set variable and true Branch reach choice"), Runtime.StartStory())) return false;
    TestEqual(TEXT("choice phase"), Runtime.GetPhase(), EStoryBlueprintPhase::Choice);
    const FStoryBlueprintChoiceRequest Request = Runtime.GetChoiceRequest();
    if (!TestEqual(TEXT("hidden option removed"), Request.Options.Num(), 2)) return false;
    TestEqual(TEXT("filtered first ID"), Request.Options[0].Id, FString(TEXT("opt_locked")));
    TestEqual(TEXT("filtered first Text ID"), Request.Options[0].TextId, FString(TEXT("t_locked")));
    TestFalse(TEXT("locked option remains visible but disabled"), Request.Options[0].bEnabled);
    TestTrue(TEXT("enabledIf short circuits invalid arithmetic"), Request.Options[1].bEnabled);
    TestEqual(TEXT("prompt uses updated variable"), Request.Prompt, FString(TEXT("gold=15")));
    TestFalse(TEXT("disabled choice cannot advance"), Runtime.ChooseOption(0));
    TestEqual(TEXT("disabled input preserves pending choice"), Runtime.GetPhase(), EStoryBlueprintPhase::Choice);
    if (!TestTrue(TEXT("enabled choice advances"), Runtime.ChooseOption(1))) return false;
    TestEqual(TEXT("member/index/convert/text interpolation"), Runtime.GetMessage(),
        FString(TEXT("gold=15; member=12; index=8; map=4; hex=16; concat=AB; null=; decimal=0.1")));
    if (!Runtime.Advance()) return false;
    TestEqual(TEXT("main story completes"), Runtime.GetPhase(), EStoryBlueprintPhase::Completed);
    if (!Runtime.LoadStory(File, TEXT("s_alternate")) || !Runtime.StartStory()) return false;
    TestEqual(TEXT("explicit Story selection uses false Branch"), Runtime.GetMessage(), FString(TEXT("Alternate Story")));
    TestTrue(TEXT("narration metadata retained"), Runtime.GetDialogueRequest().bNarration);

    UStoryBlueprintHostComponent* Host = NewObject<UStoryBlueprintHostComponent>(GetTransientPackage());
    Host->StoryRelativePath = TEXT("StoryBlueprint/Fixtures/conditional-project.storyc.json");
    if (!Host->PlayStory()) return false;
    const FString Completion = Host->GetPresentationCompletionId();
    TestFalse(TEXT("hidden ID rejected by Host"), Host->CompleteChoice(Completion, TEXT("opt_hidden")));
    TestFalse(TEXT("disabled ID rejected by Host"), Host->CompleteChoice(Completion, TEXT("opt_locked")));
    TestEqual(TEXT("invalid choice preserves completion token"), Host->GetPresentationCompletionId(), Completion);
    TestTrue(TEXT("same UI request can still choose enabled option"), Host->CompleteChoice(Completion, TEXT("opt_ready")));
    Host->EntryStoryId = TEXT("s_alternate");
    if (!Host->PlayStory()) return false;
    TestEqual(TEXT("Host EntryStoryId applied"), Host->GetSelectedStoryId(), FString(TEXT("s_alternate")));
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintExpressionsTest,
    "StoryBlueprint.Expressions", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintExpressionsTest::RunTest(const FString& Parameters)
{
    const auto Fixture = ReadFixture(TEXT("expression-cases.json"));
    if (!TestTrue(TEXT("expression fixture exists"), Fixture.IsValid())) return false;
    const TMap<FString, TSharedPtr<FJsonObject>> Types;
    const TMap<FString, TSharedPtr<FJsonValue>> Variables;
    for (const auto& Value : Fixture->GetArrayField(TEXT("cases")))
    {
        const auto Case = Value->AsObject();
        const FString Name = Case->GetStringField(TEXT("name"));
        const auto Expression = Case->GetObjectField(TEXT("expression"));
        bool bValidationError = false, bExpectedError = false;
        Case->TryGetBoolField(TEXT("expectedValidationError"), bValidationError);
        Case->TryGetBoolField(TEXT("expectedError"), bExpectedError);
        const bool bValid = FStoryBlueprintEvaluator::ValidateExpression(Expression, Types);
        if (!TestEqual(Name + TEXT(": AST validation"), bValid, !bValidationError)) continue;
        if (bValidationError) continue;
        FString Error;
        const auto Result = FStoryBlueprintEvaluator::Evaluate(Expression, Variables, Error);
        if (bExpectedError)
        {
            TestFalse(Name + TEXT(": rejected"), Result.IsValid());
            TestFalse(Name + TEXT(": diagnostic"), Error.IsEmpty());
            continue;
        }
        if (!TestTrue(Name + TEXT(": evaluated: ") + Error, Result.IsValid())) continue;
        TestTrue(Name + TEXT(": result type"), Result->Type == Case->TryGetField(TEXT("expected"))->Type);
        TestEqual(Name + TEXT(": formatted value"), FStoryBlueprintEvaluator::FormatValue(Result), Case->GetStringField(TEXT("expectedText")));
    }
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintProjectValidationTest,
    "StoryBlueprint.ProjectValidation", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintProjectValidationTest::RunTest(const FString& Parameters)
{
    const auto Original = ReadFixture(TEXT("conditional-project.storyc.json"));
    if (!Original) return false;
    const FString Json = JsonText(Original);
    FStoryBlueprintArtifact Artifact;
    FString Error;
    TestFalse(TEXT("unknown Story rejected"), FStoryBlueprintProject::Parse(Json, TEXT("s_missing"), Artifact, Error));
    TestTrue(TEXT("unknown Story error identifies selection"), Error.Contains(TEXT("s_missing")));
    TestFalse(TEXT("failed parse exposes no program"), Artifact.Program.IsValid());
    auto Mutated = ReadFixture(TEXT("conditional-project.storyc.json"));
    Mutated->SetNumberField(TEXT("version"), 1.5);
    TestFalse(TEXT("fractional project version rejected"), FStoryBlueprintProject::Parse(JsonText(Mutated), TEXT(""), Artifact, Error));
    Mutated = ReadFixture(TEXT("conditional-project.storyc.json"));
    const auto Stories = Mutated->GetObjectField(TEXT("stories"));
    Stories->GetObjectField(TEXT("s_alternate"))->GetObjectField(TEXT("program"))->SetStringField(TEXT("contentVersion"), TEXT("different"));
    TestFalse(TEXT("unselected story content mismatch rejected"), FStoryBlueprintProject::Parse(JsonText(Mutated), TEXT(""), Artifact, Error));
    TestTrue(TEXT("mismatch diagnostic identifies Story"), Error.Contains(TEXT("s_alternate")));
    Mutated = ReadFixture(TEXT("conditional-project.storyc.json"));
    const auto Program = Mutated->GetObjectField(TEXT("stories"))->GetObjectField(TEXT("s_conditions"))->GetObjectField(TEXT("program"));
    Program->SetNumberField(TEXT("version"), 7.5);
    TestFalse(TEXT("fractional runtime version rejected"), FStoryBlueprintProject::Parse(JsonText(Mutated), TEXT(""), Artifact, Error));
    Program->SetNumberField(TEXT("version"), 7);
    TestTrue(TEXT("standalone extraction still loads"), FStoryBlueprintProject::Parse(JsonText(Program), TEXT("p_conditions"), Artifact, Error));
    TestFalse(TEXT("standalone mismatch rejected"), FStoryBlueprintProject::Parse(JsonText(Program), TEXT("s_conditions"), Artifact, Error));
    Mutated = ReadFixture(TEXT("conditional-project.storyc.json"));
    const auto Selected = Mutated->GetObjectField(TEXT("stories"))->GetObjectField(TEXT("s_conditions"))->GetObjectField(TEXT("program"));
    const auto Options = Selected->GetObjectField(TEXT("blocks"))->GetObjectField(TEXT("b_choice"))->GetArrayField(TEXT("instructions"))[0]->AsObject()->GetArrayField(TEXT("options"));
    const auto FalseCondition = Options[0]->AsObject()->GetObjectField(TEXT("visibleIf"));
    for (const auto& Option : Options) Option->AsObject()->SetObjectField(TEXT("enabledIf"), FalseCondition);
    FStoryBlueprintRuntime Runtime;
    if (!Runtime.LoadStoryJson(JsonText(Mutated))) return false;
    AddExpectedError(TEXT("Choice has no visible enabled options"), EAutomationExpectedErrorFlags::Contains, 2);
    TestFalse(TEXT("all-disabled choice fails explicitly"), Runtime.StartStory());
    for (const auto& Option : Options) Option->AsObject()->SetObjectField(TEXT("visibleIf"), FalseCondition);
    if (!Runtime.LoadStoryJson(JsonText(Mutated))) return false;
    TestFalse(TEXT("all-hidden choice fails explicitly"), Runtime.StartStory());
    Selected->GetObjectField(TEXT("blocks"))->GetObjectField(TEXT("b_entry"))->GetArrayField(TEXT("instructions"))[1]->AsObject()->SetStringField(TEXT("whenTrue"), TEXT("b_missing"));
    AddExpectedError(TEXT("Invalid Branch condition or target"), EAutomationExpectedErrorFlags::Contains, 1);
    TestFalse(TEXT("invalid Branch target rejected at load"), Runtime.LoadStoryJson(JsonText(Mutated)));
    return true;
}
namespace
{
TSharedPtr<FJsonObject> ParseSnapshot(const FStoryBlueprintRuntime& Runtime)
{
    TSharedPtr<FJsonObject> Object;
    FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Runtime.GetDebugSnapshotJson()), Object);
    return Object;
}

FString EnemyPayload(const TCHAR* Boss, int32 Score, bool bMatch = true)
{
    // Deliberately reverse object field order relative to the exported match expression.
    return FString::Printf(TEXT("{\"bossId\":\"%s\",\"score\":%d,\"detail\":{\"meta\":{\"zone\":\"cave\"},\"tags\":[%s]}}"),
        Boss, Score, bMatch ? TEXT("1,2") : TEXT("2,1"));
}

FString RewardResult(int32 Amount)
{
    return FString::Printf(TEXT("{\"evo_amount\":%d,\"evo_status\":\"ok\",\"evo_success\":true,\"extra\":123}"), Amount);
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintEventSignalOutputsTest,
    "StoryBlueprint.EventSignalOutputs", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintEventSignalOutputsTest::RunTest(const FString& Parameters)
{
    FStoryBlueprintRuntime Runtime;
    const FString File = FixturePath(TEXT("event-signal-project.storyc.json"));
    if (!Runtime.LoadStory(File)) return false;
    TestTrue(TEXT("pre-start signal accepted"), Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("red"), 99, false)));
    Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("blue"), 7));
    Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("red"), 11));
    Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("red"), 22));
    if (!Runtime.StartStory() || !Runtime.Advance()) return false;
    TestEqual(TEXT("buffered signal proceeds to event"), Runtime.GetPhase(), EStoryBlueprintPhase::Event);
    TSharedPtr<FJsonObject> Arguments;
    FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Runtime.GetPendingEventArgumentsJson()), Arguments);
    if (!Arguments) return false;
    TestEqual(TEXT("oldest matching payload is event input"), Arguments->GetNumberField(TEXT("amount")), 11.0);
    if (!Runtime.CompleteEvent(RewardResult(500))) return false;
    TestEqual(TEXT("variable and output pins"), Runtime.GetMessage(), FString(TEXT("reward=500; event=500; signal=11; status=ok; ok=true")));
    if (!Runtime.Advance()) return false;
    TestEqual(TEXT("skipped blue payload retained"), Runtime.GetMessage(), FString(TEXT("blue=7")));
    if (!Runtime.Advance()) return false;
    TestEqual(TEXT("consumed red not reused"), Runtime.GetMessage(), FString(TEXT("red2=22; cached=500")));
    if (!Runtime.Advance()) return false;
    TestEqual(TEXT("flow completes"), Runtime.GetPhase(), EStoryBlueprintPhase::Completed);
    auto Snapshot = ParseSnapshot(Runtime);
    if (!Snapshot) return false;
    const auto Results = Snapshot->GetObjectField(TEXT("eventOutputs"))->GetObjectField(TEXT("i_reward"));
    TestFalse(TEXT("undeclared event result excluded"), Results->HasField(TEXT("extra")));
    TestEqual(TEXT("variable committed"), Snapshot->GetObjectField(TEXT("variables"))->GetNumberField(TEXT("v_reward")), 500.0);
    TestTrue(TEXT("full signal payload cached"), Snapshot->GetObjectField(TEXT("signalOutputs"))->GetObjectField(TEXT("i_wait_red"))->HasField(TEXT("detail")));
    TestEqual(TEXT("nested array mismatch remains buffered"), Snapshot->GetObjectField(TEXT("signalInbox"))->GetArrayField(TEXT("sig_enemy")).Num(), 1);
    if (!Runtime.StartStory() || !Runtime.Advance()) return false;
    TestEqual(TEXT("restart discards inbox"), Runtime.GetPhase(), EStoryBlueprintPhase::Signal);
    Snapshot = ParseSnapshot(Runtime);
    TestEqual(TEXT("restart discards output cache"), Snapshot->GetObjectField(TEXT("eventOutputs"))->Values.Num(), 0);
    TestTrue(TEXT("pending match exposed"), Runtime.GetPendingSignalMatchesJson().Contains(TEXT("bossId")));
    TestTrue(TEXT("live nonmatch accepted"), Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("red"), 9, false)));
    TestEqual(TEXT("nonmatch preserves pending wait"), Runtime.GetPhase(), EStoryBlueprintPhase::Signal);
    TestTrue(TEXT("live match resumes"), Runtime.SendSignal(TEXT("sig_enemy"), EnemyPayload(TEXT("red"), 10)));
    TestEqual(TEXT("live match reaches event"), Runtime.GetPhase(), EStoryBlueprintPhase::Event);

    if (!Runtime.LoadStory(File, TEXT("s_repeat")) || !Runtime.StartStory() || !Runtime.CompleteEvent(RewardResult(500)) || !Runtime.Advance()) return false;
    Snapshot = ParseSnapshot(Runtime);
    TestEqual(TEXT("previous result retained while next call pending"), Snapshot->GetObjectField(TEXT("eventOutputs"))->GetObjectField(TEXT("i_repeat"))->GetNumberField(TEXT("evo_amount")), 500.0);
    if (!Runtime.CompleteEvent(RewardResult(750))) return false;
    TestEqual(TEXT("latest occurrence rendered"), Runtime.GetMessage(), FString(TEXT("value=750")));
    Snapshot = ParseSnapshot(Runtime);
    TestEqual(TEXT("one cache slot per instruction"), Snapshot->GetObjectField(TEXT("eventOutputs"))->Values.Num(), 1);

    UStoryBlueprintHostComponent* Host = NewObject<UStoryBlueprintHostComponent>(GetTransientPackage());
    Host->StoryRelativePath = TEXT("StoryBlueprint/Fixtures/event-signal-project.storyc.json");
    Host->EntryStoryId = TEXT("s_repeat");
    if (!Host->PlayStory()) return false;
    const FString First = Host->GetPendingEventRequest().CompletionId;
    if (!Host->CompleteEvent(First, RewardResult(1)) || !Host->Advance()) return false;
    TestFalse(TEXT("same producer cannot reuse earlier completion token"), Host->CompleteEvent(First, RewardResult(2)));
    TestTrue(TEXT("new occurrence completes"), Host->CompleteEvent(Host->GetPendingEventRequest().CompletionId, RewardResult(2)));
    Host->StopStory();
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStoryBlueprintOutputValidationTest,
    "StoryBlueprint.OutputValidation", EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FStoryBlueprintOutputValidationTest::RunTest(const FString& Parameters)
{
    const FString File = FixturePath(TEXT("event-signal-project.storyc.json"));
    FStoryBlueprintRuntime Runtime;
    const TArray<FString> InvalidResults = {
        TEXT("{\"evo_amount\":500,\"evo_status\":\"ok\"}"),
        TEXT("{\"evo_amount\":500,\"evo_status\":\"ok\",\"evo_success\":0}"),
        TEXT("{\"evo_amount\":500,\"evo_status\":\"bad\",\"evo_success\":true}")
    };
    AddExpectedError(TEXT("Missing or invalid event output evo_success"), EAutomationExpectedErrorFlags::Contains, 2);
    AddExpectedError(TEXT("Event output does not match target variable"), EAutomationExpectedErrorFlags::Contains, 1);
    for (const auto& Result : InvalidResults)
    {
        if (!Runtime.LoadStory(File, TEXT("s_repeat")) || !Runtime.StartStory()) return false;
        TestFalse(TEXT("invalid result rejected"), Runtime.CompleteEvent(Result));
        const auto Snapshot = ParseSnapshot(Runtime);
        if (!Snapshot) return false;
        TestEqual(TEXT("failure commits no output cache"), Snapshot->GetObjectField(TEXT("eventOutputs"))->Values.Num(), 0);
        TestEqual(TEXT("failure commits no numeric write"), Snapshot->GetObjectField(TEXT("variables"))->GetNumberField(TEXT("v_reward")), 0.0);
        TestEqual(TEXT("failure commits no enum write"), Snapshot->GetObjectField(TEXT("variables"))->GetStringField(TEXT("v_reward_status")), FString(TEXT("ok")));
    }
    if (!Runtime.LoadStory(File) || !Runtime.StartStory()) return false;
    AddExpectedError(TEXT("Missing or invalid Signal payload field"), EAutomationExpectedErrorFlags::Contains, 1);
    TestFalse(TEXT("incomplete signal rejected before enqueue"), Runtime.SendSignal(TEXT("sig_enemy"), TEXT("{\"bossId\":\"red\"}")));
    TestEqual(TEXT("invalid payload not buffered"), ParseSnapshot(Runtime)->GetObjectField(TEXT("signalInbox"))->Values.Num(), 0);

    auto Mutated = ReadFixture(TEXT("event-signal-project.storyc.json"));
    const auto Program = Mutated->GetObjectField(TEXT("stories"))->GetObjectField(TEXT("s_flow"))->GetObjectField(TEXT("program"));
    const auto Blocks = Program->GetObjectField(TEXT("blocks"));
    const auto ReportText = Blocks->GetObjectField(TEXT("b_report"))->GetArrayField(TEXT("instructions"))[0]->AsObject()->GetObjectField(TEXT("text"));
    Blocks->GetObjectField(TEXT("b_entry"))->GetArrayField(TEXT("instructions"))[0]->AsObject()->SetObjectField(TEXT("text"), ReportText);
    if (!Runtime.LoadStoryJson(JsonText(Mutated))) return false;
    AddExpectedError(TEXT("is not available"), EAutomationExpectedErrorFlags::Contains, 1);
    TestFalse(TEXT("output read before completion fails explicitly"), Runtime.StartStory());
    const auto OutputExpression = ReportText->GetArrayField(TEXT("parts"))[3]->AsObject()->GetObjectField(TEXT("expression"));
    OutputExpression->SetStringField(TEXT("instructionId"), TEXT("i_missing"));
    AddExpectedError(TEXT("Unsupported text"), EAutomationExpectedErrorFlags::Contains, 1);
    TestFalse(TEXT("missing producer rejected at load"), Runtime.LoadStoryJson(JsonText(Mutated)));
    return true;
}
#endif
