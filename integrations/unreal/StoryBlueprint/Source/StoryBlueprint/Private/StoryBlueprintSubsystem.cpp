#include "StoryBlueprintSubsystem.h"
#include "Dom/JsonValue.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

namespace
{
TSharedPtr<FJsonObject> ObjectField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name)
{
    return Object.IsValid() && Object->HasTypedField<EJson::Object>(Name)
        ? Object->GetObjectField(Name) : nullptr;
}

FString StringField(const TSharedPtr<FJsonObject>& Object, const TCHAR* Name)
{
    FString Value;
    if (Object.IsValid()) Object->TryGetStringField(Name, Value);
    return Value;
}

bool ParseObject(const FString& Json, TSharedPtr<FJsonObject>& Result)
{
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
    return FJsonSerializer::Deserialize(Reader, Result) && Result.IsValid();
}

bool ScalarEquals(const TSharedPtr<FJsonValue>& A, const TSharedPtr<FJsonValue>& B)
{
    if (!A.IsValid() || !B.IsValid() || A->Type != B->Type) return false;
    switch (A->Type)
    {
    case EJson::String: return A->AsString() == B->AsString();
    case EJson::Number: return A->AsNumber() == B->AsNumber();
    case EJson::Boolean: return A->AsBool() == B->AsBool();
    case EJson::Null: return true;
    default: return false;
    }
}

bool ValueMatchesType(const TSharedPtr<FJsonValue>& Value, const FString& Kind)
{
    if (!Value.IsValid()) return false;
    if (Kind == TEXT("boolean")) return Value->Type == EJson::Boolean;
    if (Kind == TEXT("number")) return Value->Type == EJson::Number;
    if (Kind == TEXT("string") || Kind == TEXT("character-ref") || Kind == TEXT("asset-ref"))
        return Value->Type == EJson::String;
    if (Kind == TEXT("json")) return true;
    return false;
}
}

bool UStoryBlueprintSubsystem::Fail(const FString& Error)
{
    LastError = Error;
    Message = Error;
    Phase = EStoryBlueprintPhase::Failed;
    UE_LOG(LogTemp, Error, TEXT("Story Blueprint: %s"), *Error);
    return false;
}

bool UStoryBlueprintSubsystem::LoadStory(const FString& AbsolutePath)
{
    Program.Reset();
    Blocks.Reset();
    Variables.Empty();
    PendingInstruction.Reset();
    ChoiceLabels.Empty();
    ChoiceTargets.Empty();
    Phase = EStoryBlueprintPhase::Idle;
    LastError.Empty();
    Message.Empty();
    FString Json;
    if (!FFileHelper::LoadFileToString(Json, *AbsolutePath))
        return Fail(FString::Printf(TEXT("Cannot read %s"), *AbsolutePath));
    if (!ParseObject(Json, Program)) return Fail(TEXT("Invalid story JSON"));
    if (!ValidateProgram()) return false;
    return true;
}

bool UStoryBlueprintSubsystem::ValidateExpression(const TSharedPtr<FJsonObject>& Expression) const
{
    const FString Kind = StringField(Expression, TEXT("kind"));
    if (Kind == TEXT("literal")) return Expression->HasField(TEXT("value"));
    if (Kind == TEXT("variable")) return !StringField(Expression, TEXT("variableId")).IsEmpty();
    return false;
}

bool UStoryBlueprintSubsystem::ValidateText(const TSharedPtr<FJsonObject>& Text) const
{
    if (!Text.IsValid() || !Text->HasTypedField<EJson::Array>(TEXT("parts")) ||
        Text->HasField(TEXT("locales"))) return false;
    for (const TSharedPtr<FJsonValue>& PartValue : Text->GetArrayField(TEXT("parts")))
    {
        if (!PartValue.IsValid() || PartValue->Type != EJson::Object) return false;
        const TSharedPtr<FJsonObject> Part = PartValue->AsObject();
        const FString Kind = StringField(Part, TEXT("kind"));
        if (Kind == TEXT("text"))
        {
            if (!Part->HasTypedField<EJson::String>(TEXT("value"))) return false;
        }
        else if (Kind == TEXT("expression"))
        {
            if (!ValidateExpression(ObjectField(Part, TEXT("expression")))) return false;
        }
        else return false;
    }
    return true;
}

bool UStoryBlueprintSubsystem::ValidateProgram()
{
    if (StringField(Program, TEXT("format")) != TEXT("story-runtime") ||
        !Program->HasTypedField<EJson::Number>(TEXT("version")) ||
        Program->GetIntegerField(TEXT("version")) != 7)
        return Fail(TEXT("Only standalone story-runtime@7 is supported"));
    Blocks = ObjectField(Program, TEXT("blocks"));
    if (!Blocks.IsValid() || !Blocks->HasTypedField<EJson::Object>(StringField(Program, TEXT("entryBlockId"))))
        return Fail(TEXT("Missing blocks or entry block"));
    if (!Program->HasTypedField<EJson::Array>(TEXT("variables")))
        return Fail(TEXT("Missing variables array"));
    for (const TSharedPtr<FJsonValue>& VariableValue : Program->GetArrayField(TEXT("variables")))
    {
        if (!VariableValue.IsValid() || VariableValue->Type != EJson::Object)
            return Fail(TEXT("Invalid variable definition"));
        const TSharedPtr<FJsonObject> Variable = VariableValue->AsObject();
        const FString Scope = StringField(Variable, TEXT("scope"));
        if (StringField(Variable, TEXT("id")).IsEmpty() || Scope != TEXT("story") ||
            !Variable->HasField(TEXT("defaultValue")))
            return Fail(TEXT("The sample runtime supports story-scoped variables only"));
        const TSharedPtr<FJsonObject> Type = ObjectField(Variable, TEXT("valueType"));
        if (!Type.IsValid() || !ValueMatchesType(Variable->TryGetField(TEXT("defaultValue")), StringField(Type, TEXT("kind"))))
            return Fail(TEXT("Invalid or unsupported variable default type"));
    }
    for (const auto& BlockPair : Blocks->Values)
    {
        if (!BlockPair.Value.IsValid() || BlockPair.Value->Type != EJson::Object)
            return Fail(FString::Printf(TEXT("Invalid block %s"), *BlockPair.Key));
        const TSharedPtr<FJsonObject> Block = BlockPair.Value->AsObject();
        if (!Block->HasTypedField<EJson::Array>(TEXT("instructions")))
            return Fail(FString::Printf(TEXT("Missing instructions in %s"), *BlockPair.Key));
        for (const TSharedPtr<FJsonValue>& InstructionValue : Block->GetArrayField(TEXT("instructions")))
        {
            if (!InstructionValue.IsValid() || InstructionValue->Type != EJson::Object)
                return Fail(FString::Printf(TEXT("Invalid instruction in %s"), *BlockPair.Key));
            const TSharedPtr<FJsonObject> Instruction = InstructionValue->AsObject();
            const FString Op = StringField(Instruction, TEXT("op"));
            const FString Id = StringField(Instruction, TEXT("id"));
            if (Id.IsEmpty()) return Fail(TEXT("Instruction missing ID"));
            if (Op == TEXT("jump"))
            {
                if (!Blocks->HasTypedField<EJson::Object>(StringField(Instruction, TEXT("target"))))
                    return Fail(FString::Printf(TEXT("Invalid jump target at %s"), *Id));
            }
            else if (Op == TEXT("dialogue") || Op == TEXT("narration"))
            {
                if (Instruction->HasField(TEXT("dynamicSpeaker")) ||
                    !ValidateText(ObjectField(Instruction, TEXT("text"))))
                    return Fail(FString::Printf(TEXT("Unsupported text at %s"), *Id));
            }
            else if (Op == TEXT("choice"))
            {
                if (!Instruction->HasTypedField<EJson::Array>(TEXT("options"))) return Fail(TEXT("Choice has no options"));
                if (Instruction->HasField(TEXT("prompt")) && !ValidateText(ObjectField(Instruction, TEXT("prompt"))))
                    return Fail(FString::Printf(TEXT("Unsupported choice prompt at %s"), *Id));
                for (const TSharedPtr<FJsonValue>& OptionValue : Instruction->GetArrayField(TEXT("options")))
                {
                    if (!OptionValue.IsValid() || OptionValue->Type != EJson::Object) return Fail(TEXT("Invalid choice option"));
                    const TSharedPtr<FJsonObject> Option = OptionValue->AsObject();
                    if (Option->HasField(TEXT("visibleIf")) || Option->HasField(TEXT("enabledIf")) ||
                        !ValidateText(ObjectField(Option, TEXT("text"))) ||
                        !Blocks->HasTypedField<EJson::Object>(StringField(Option, TEXT("target"))))
                        return Fail(FString::Printf(TEXT("Unsupported choice option at %s"), *Id));
                }
            }
            else if (Op == TEXT("set-variable"))
            {
                if (Instruction->HasField(TEXT("containerOperation")) ||
                    !ValidateExpression(ObjectField(Instruction, TEXT("value"))))
                    return Fail(FString::Printf(TEXT("Unsupported assignment at %s"), *Id));
            }
            else if (Op == TEXT("wait-signal"))
            {
                const TSharedPtr<FJsonObject> Matches = ObjectField(Instruction, TEXT("matches"));
                if (!Matches.IsValid()) return Fail(FString::Printf(TEXT("Missing signal matches at %s"), *Id));
                for (const auto& Pair : Matches->Values)
                    if (!Pair.Value.IsValid() || Pair.Value->Type != EJson::Object || !ValidateExpression(Pair.Value->AsObject()))
                        return Fail(FString::Printf(TEXT("Unsupported signal match at %s"), *Id));
            }
            else if (Op == TEXT("call-event"))
            {
                const TSharedPtr<FJsonObject> Arguments = ObjectField(Instruction, TEXT("arguments"));
                if (!Arguments.IsValid() || !Instruction->HasTypedField<EJson::Array>(TEXT("outputs")))
                    return Fail(FString::Printf(TEXT("Invalid event at %s"), *Id));
                for (const auto& Pair : Arguments->Values)
                    if (!Pair.Value.IsValid() || Pair.Value->Type != EJson::Object || !ValidateExpression(Pair.Value->AsObject()))
                        return Fail(FString::Printf(TEXT("Unsupported event argument at %s"), *Id));
                const TSharedPtr<FJsonObject> ResultVariables = ObjectField(Instruction, TEXT("resultVariableIds"));
                if (Instruction->HasField(TEXT("instanceVariableId")) ||
                    (ResultVariables.IsValid() && ResultVariables->Values.Num() > 0))
                    return Fail(FString::Printf(TEXT("Event result assignments are not yet supported at %s"), *Id));
                for (const TSharedPtr<FJsonValue>& OutputValue : Instruction->GetArrayField(TEXT("outputs")))
                {
                    if (!OutputValue.IsValid() || OutputValue->Type != EJson::Object)
                        return Fail(FString::Printf(TEXT("Invalid event output at %s"), *Id));
                    const TSharedPtr<FJsonObject> Output = OutputValue->AsObject();
                    const FString Kind = StringField(ObjectField(Output, TEXT("valueType")), TEXT("kind"));
                    if (StringField(Output, TEXT("id")).IsEmpty() ||
                        (Kind != TEXT("boolean") && Kind != TEXT("number") && Kind != TEXT("string") && Kind != TEXT("json")))
                        return Fail(FString::Printf(TEXT("Unsupported event output at %s"), *Id));
                }
            }
            else if (Op != TEXT("end-story"))
                return Fail(FString::Printf(TEXT("Unsupported instruction %s at %s"), *Op, *Id));
        }
    }
    return true;
}

bool UStoryBlueprintSubsystem::StartStory()
{
    if (!Program.IsValid() || !Blocks.IsValid()) return Fail(TEXT("Load a valid story first"));
    Variables.Empty();
    for (const TSharedPtr<FJsonValue>& VariableValue : Program->GetArrayField(TEXT("variables")))
    {
        const TSharedPtr<FJsonObject> Variable = VariableValue->AsObject();
        Variables.Add(StringField(Variable, TEXT("id")), Variable->TryGetField(TEXT("defaultValue")));
    }
    BlockId = StringField(Program, TEXT("entryBlockId"));
    InstructionIndex = 0;
    PendingInstruction.Reset();
    PendingEventId.Empty();
    PendingEventArgumentsJson.Empty();
    ChoiceLabels.Empty();
    ChoiceTargets.Empty();
    LastError.Empty();
    Message.Empty();
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}

TSharedPtr<FJsonObject> UStoryBlueprintSubsystem::CurrentInstruction() const
{
    if (!Blocks.IsValid() || !Blocks->HasTypedField<EJson::Object>(BlockId)) return nullptr;
    const TSharedPtr<FJsonObject> Block = Blocks->GetObjectField(BlockId);
    const TArray<TSharedPtr<FJsonValue>>& Instructions = Block->GetArrayField(TEXT("instructions"));
    if (!Instructions.IsValidIndex(InstructionIndex)) return nullptr;
    return Instructions[InstructionIndex]->AsObject();
}

TSharedPtr<FJsonValue> UStoryBlueprintSubsystem::Evaluate(const TSharedPtr<FJsonObject>& Expression)
{
    const FString Kind = StringField(Expression, TEXT("kind"));
    if (Kind == TEXT("literal")) return Expression->TryGetField(TEXT("value"));
    if (Kind == TEXT("variable"))
    {
        const TSharedPtr<FJsonValue>* Found = Variables.Find(StringField(Expression, TEXT("variableId")));
        if (Found) return *Found;
    }
    Fail(TEXT("Expression refers to an unavailable variable"));
    return nullptr;
}

FString UStoryBlueprintSubsystem::RenderText(const TSharedPtr<FJsonObject>& Text)
{
    FString Result;
    for (const TSharedPtr<FJsonValue>& PartValue : Text->GetArrayField(TEXT("parts")))
    {
        const TSharedPtr<FJsonObject> Part = PartValue->AsObject();
        if (StringField(Part, TEXT("kind")) == TEXT("text")) Result += StringField(Part, TEXT("value"));
        else
        {
            const TSharedPtr<FJsonValue> Value = Evaluate(ObjectField(Part, TEXT("expression")));
            if (!Value.IsValid()) return FString();
            if (Value->Type == EJson::String) Result += Value->AsString();
            else if (Value->Type == EJson::Number) Result += FString::SanitizeFloat(Value->AsNumber());
            else if (Value->Type == EJson::Boolean) Result += Value->AsBool() ? TEXT("true") : TEXT("false");
            else return Fail(TEXT("Cannot interpolate a complex value")), FString();
        }
    }
    return Result;
}

bool UStoryBlueprintSubsystem::MoveTo(const FString& TargetBlock)
{
    if (!Blocks->HasTypedField<EJson::Object>(TargetBlock)) return Fail(TEXT("Invalid block target"));
    BlockId = TargetBlock;
    InstructionIndex = 0;
    return true;
}

bool UStoryBlueprintSubsystem::RunUntilPause()
{
    for (int32 Steps = 0; Steps < 10000; ++Steps)
    {
        const TSharedPtr<FJsonObject> Instruction = CurrentInstruction();
        if (!Instruction.IsValid()) return Fail(TEXT("Story reached an invalid instruction location"));
        const FString Op = StringField(Instruction, TEXT("op"));
        if (Op == TEXT("jump"))
        {
            if (!MoveTo(StringField(Instruction, TEXT("target")))) return false;
        }
        else if (Op == TEXT("set-variable"))
        {
            const FString VariableId = StringField(Instruction, TEXT("variableId"));
            if (!Variables.Contains(VariableId)) return Fail(TEXT("Assignment refers to an unavailable variable"));
            const TSharedPtr<FJsonValue> Value = Evaluate(ObjectField(Instruction, TEXT("value")));
            if (!Value.IsValid()) return false;
            Variables.Add(VariableId, Value);
            ++InstructionIndex;
        }
        else if (Op == TEXT("dialogue") || Op == TEXT("narration"))
        {
            Message = RenderText(ObjectField(Instruction, TEXT("text")));
            if (Phase == EStoryBlueprintPhase::Failed) return false;
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Dialogue;
            return true;
        }
        else if (Op == TEXT("choice"))
        {
            ChoiceLabels.Empty();
            ChoiceTargets.Empty();
            for (const TSharedPtr<FJsonValue>& OptionValue : Instruction->GetArrayField(TEXT("options")))
            {
                const TSharedPtr<FJsonObject> Option = OptionValue->AsObject();
                ChoiceLabels.Add(RenderText(ObjectField(Option, TEXT("text"))));
                if (Phase == EStoryBlueprintPhase::Failed) return false;
                ChoiceTargets.Add(StringField(Option, TEXT("target")));
            }
            if (ChoiceLabels.IsEmpty()) return Fail(TEXT("Choice has no available options"));
            const TSharedPtr<FJsonObject> Prompt = ObjectField(Instruction, TEXT("prompt"));
            Message = Prompt.IsValid() ? RenderText(Prompt) : TEXT("Choose:");
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Choice;
            return true;
        }
        else if (Op == TEXT("wait-signal"))
        {
            Message = FString::Printf(TEXT("Waiting for signal %s"), *StringField(Instruction, TEXT("signalId")));
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Signal;
            return true;
        }
        else if (Op == TEXT("call-event"))
        {
            PendingEventId = StringField(Instruction, TEXT("eventId"));
            const TSharedPtr<FJsonObject> Arguments = MakeShared<FJsonObject>();
            for (const auto& Pair : ObjectField(Instruction, TEXT("arguments"))->Values)
            {
                const TSharedPtr<FJsonValue> Value = Evaluate(Pair.Value->AsObject());
                if (!Value.IsValid()) return false;
                Arguments->SetField(Pair.Key, Value);
            }
            PendingEventArgumentsJson.Empty();
            const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&PendingEventArgumentsJson);
            if (!FJsonSerializer::Serialize(Arguments.ToSharedRef(), Writer))
                return Fail(TEXT("Cannot serialize event arguments"));
            Message = FString::Printf(TEXT("Waiting for event %s"), *PendingEventId);
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Event;
            return true;
        }
        else if (Op == TEXT("end-story"))
        {
            Message = TEXT("Story completed");
            PendingInstruction.Reset();
            Phase = EStoryBlueprintPhase::Completed;
            return true;
        }
        else return Fail(TEXT("Unexpected instruction"));
    }
    return Fail(TEXT("Story exceeded the instruction step limit"));
}

bool UStoryBlueprintSubsystem::Advance()
{
    if (Phase != EStoryBlueprintPhase::Dialogue) return false;
    PendingInstruction.Reset();
    ++InstructionIndex;
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}

bool UStoryBlueprintSubsystem::ChooseOption(int32 Index)
{
    if (Phase != EStoryBlueprintPhase::Choice || !ChoiceTargets.IsValidIndex(Index)) return false;
    const FString Target = ChoiceTargets[Index];
    PendingInstruction.Reset();
    ChoiceLabels.Empty();
    ChoiceTargets.Empty();
    Phase = EStoryBlueprintPhase::Idle;
    return MoveTo(Target) && RunUntilPause();
}

bool UStoryBlueprintSubsystem::SendSignal(const FString& SignalId, const FString& PayloadJson)
{
    if (Phase != EStoryBlueprintPhase::Signal || !PendingInstruction.IsValid() ||
        SignalId != StringField(PendingInstruction, TEXT("signalId"))) return false;
    TSharedPtr<FJsonObject> Payload;
    if (!ParseObject(PayloadJson, Payload)) return Fail(TEXT("Invalid signal payload JSON"));
    const TSharedPtr<FJsonObject> Matches = ObjectField(PendingInstruction, TEXT("matches"));
    for (const auto& Pair : Matches->Values)
    {
        const TSharedPtr<FJsonValue> Expected = Evaluate(Pair.Value->AsObject());
        if (!Expected.IsValid()) return false;
        if (!ScalarEquals(Expected, Payload->TryGetField(Pair.Key))) return false;
    }
    PendingInstruction.Reset();
    ++InstructionIndex;
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}

bool UStoryBlueprintSubsystem::CompleteEvent(const FString& ResultJson)
{
    if (Phase != EStoryBlueprintPhase::Event || !PendingInstruction.IsValid()) return false;
    TSharedPtr<FJsonObject> Result;
    if (!ParseObject(ResultJson, Result)) return Fail(TEXT("Invalid event result JSON"));
    for (const TSharedPtr<FJsonValue>& OutputValue : PendingInstruction->GetArrayField(TEXT("outputs")))
    {
        if (!OutputValue.IsValid() || OutputValue->Type != EJson::Object) return Fail(TEXT("Invalid event output declaration"));
        const TSharedPtr<FJsonObject> Output = OutputValue->AsObject();
        const FString OutputId = StringField(Output, TEXT("id"));
        const TSharedPtr<FJsonObject> Type = ObjectField(Output, TEXT("valueType"));
        if (!Type.IsValid() || !ValueMatchesType(Result->TryGetField(OutputId), StringField(Type, TEXT("kind"))))
            return Fail(FString::Printf(TEXT("Missing or invalid event output %s"), *OutputId));
    }
    PendingInstruction.Reset();
    PendingEventId.Empty();
    PendingEventArgumentsJson.Empty();
    ++InstructionIndex;
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}
