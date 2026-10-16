#include "StoryBlueprintRuntime.h"
#include "StoryBlueprintEvaluator.h"
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

bool JsonEquals(const TSharedPtr<FJsonValue>& A, const TSharedPtr<FJsonValue>& B, int32 Depth = 0)
{
    if (Depth > 128 || !A.IsValid() || !B.IsValid() || A->Type != B->Type) return false;
    switch (A->Type)
    {
    case EJson::String: return A->AsString() == B->AsString();
    case EJson::Number: return A->AsNumber() == B->AsNumber();
    case EJson::Boolean: return A->AsBool() == B->AsBool();
    case EJson::Null: return true;
    case EJson::Array:
    {
        const auto& Left = A->AsArray();
        const auto& Right = B->AsArray();
        if (Left.Num() != Right.Num()) return false;
        for (int32 Index = 0; Index < Left.Num(); ++Index) if (!JsonEquals(Left[Index], Right[Index], Depth + 1)) return false;
        return true;
    }
    case EJson::Object:
        if (A->AsObject()->Values.Num() != B->AsObject()->Values.Num()) return false;
        for (const auto& Pair : A->AsObject()->Values)
            if (!JsonEquals(Pair.Value, B->AsObject()->TryGetField(Pair.Key), Depth + 1)) return false;
        return true;
    default: return false;
    }
}

bool PayloadMatches(const TSharedPtr<FJsonObject>& Payload, const TSharedPtr<FJsonObject>& Matches)
{
    if (!Payload || !Matches) return false;
    for (const auto& Pair : Matches->Values)
        if (!JsonEquals(Pair.Value, Payload->TryGetField(Pair.Key))) return false;
    return true;
}

bool CompatibleTypes(const TSharedPtr<FJsonObject>& Source, const TSharedPtr<FJsonObject>& Target)
{
    const FString A = StringField(Source, TEXT("kind")), B = StringField(Target, TEXT("kind"));
    return !A.IsEmpty() && !B.IsEmpty() && (A == B || A == TEXT("any") || B == TEXT("any"));
}

FString ObjectJson(const TSharedPtr<FJsonObject>& Object)
{
    FString Json;
    if (Object) FJsonSerializer::Serialize(Object.ToSharedRef(), TJsonWriterFactory<>::Create(&Json));
    return Json.IsEmpty() ? TEXT("{}") : Json;
}

TSharedPtr<FJsonObject> NamedParameter(const TSharedPtr<FJsonObject>& Definition, const FString& Name)
{
    if (!Definition || !Definition->HasTypedField<EJson::Array>(TEXT("parameters"))) return nullptr;
    for (const auto& Value : Definition->GetArrayField(TEXT("parameters")))
        if (Value && Value->Type == EJson::Object && StringField(Value->AsObject(), TEXT("name")) == Name) return Value->AsObject();
    return nullptr;
}

}

bool FStoryBlueprintRuntime::Fail(const FString& Error)
{
    LastError = Error;
    Message = Error;
    Phase = EStoryBlueprintPhase::Failed;
    UE_LOG(LogTemp, Error, TEXT("Story Blueprint: %s"), *Error);
    return false;
}

bool FStoryBlueprintRuntime::LoadStory(const FString& AbsolutePath, const FString& StoryId)
{
    *this = FStoryBlueprintRuntime();
    FString Json;
    if (!FFileHelper::LoadFileToString(Json, *AbsolutePath))
        return Fail(FString::Printf(TEXT("Cannot read %s"), *AbsolutePath));
    return LoadStoryJson(Json, StoryId);
}

bool FStoryBlueprintRuntime::LoadStoryJson(const FString& Json, const FString& StoryId)
{
    *this = FStoryBlueprintRuntime();
    FString Error;
    if (!FStoryBlueprintProject::Parse(Json, StoryId, Artifact, Error)) return Fail(Error);
    Program = Artifact.Program;
    if (!ValidateProgram())
    {
        Program.Reset();
        Blocks.Reset();
        Artifact = FStoryBlueprintArtifact();
        return false;
    }
    return true;
}

bool FStoryBlueprintRuntime::ValidateExpression(const TSharedPtr<FJsonObject>& Expression) const
{
    return FStoryBlueprintEvaluator::ValidateExpression(Expression, VariableTypes, 0,
        [this](const FString& Kind, const FString& Producer, const FString& Output, const TSharedPtr<FJsonObject>& Type)
        { return ValidateOutputReference(Kind, Producer, Output, Type); });
}

bool FStoryBlueprintRuntime::ValidateOutputReference(const FString& Kind, const FString& InstructionId,
    const FString& OutputId, const TSharedPtr<FJsonObject>& Type) const
{
    const auto* Found = InstructionsById.Find(InstructionId);
    if (!Found || OutputId.IsEmpty()) return false;
    const auto Producer = *Found;
    if (Kind == TEXT("event-output"))
    {
        if (StringField(Producer, TEXT("op")) != TEXT("call-event")) return false;
        for (const auto& Output : Producer->GetArrayField(TEXT("outputs")))
            if (StringField(Output->AsObject(), TEXT("id")) == OutputId)
                return CompatibleTypes(ObjectField(Output->AsObject(), TEXT("valueType")), Type);
        return false;
    }
    if (Kind != TEXT("signal-output") || StringField(Producer, TEXT("op")) != TEXT("wait-signal")) return false;
    const auto* Definition = SignalDefinitions.Find(StringField(Producer, TEXT("signalId")));
    if (!Definition) return true; // Standalone programs have no project interface manifest.
    const auto Parameter = NamedParameter(*Definition, OutputId);
    return Parameter && CompatibleTypes(ObjectField(Parameter, TEXT("valueType")), Type);
}

bool FStoryBlueprintRuntime::IndexProgram()
{
    const bool bProject = StringField(Artifact.Root, TEXT("format")) == TEXT("story-blueprint-compiled-project");
    if (bProject)
    {
        for (const TCHAR* Field : { TEXT("events"), TEXT("signals") })
        {
            for (const auto& Value : Artifact.Root->GetArrayField(Field))
            {
                const auto Definition = Value->AsObject();
                const FString Id = StringField(Definition, TEXT("id"));
                if (!Definition->HasTypedField<EJson::Array>(TEXT("parameters"))) return Fail(TEXT("Interface declaration is missing parameters: ") + Id);
                TSet<FString> Names;
                for (const auto& Parameter : Definition->GetArrayField(TEXT("parameters")))
                {
                    if (!Parameter || Parameter->Type != EJson::Object) return Fail(TEXT("Invalid interface parameter: ") + Id);
                    const FString Name = StringField(Parameter->AsObject(), TEXT("name"));
                    if (Name.IsEmpty() || Names.Contains(Name) || !FStoryBlueprintEvaluator::ValidateType(ObjectField(Parameter->AsObject(), TEXT("valueType"))))
                        return Fail(TEXT("Invalid interface parameter name/type: ") + Id);
                    Names.Add(Name);
                }
                if (FString(Field) == TEXT("events")) EventDefinitions.Add(Id, Definition);
                else SignalDefinitions.Add(Id, Definition);
            }
        }
    }
    for (const auto& BlockPair : Blocks->Values)
    {
        if (!BlockPair.Value || BlockPair.Value->Type != EJson::Object) return Fail(TEXT("Invalid block: ") + BlockPair.Key);
        const auto Block = BlockPair.Value->AsObject();
        if (!Block->HasTypedField<EJson::Array>(TEXT("instructions"))) return Fail(TEXT("Missing instructions: ") + BlockPair.Key);
        for (const auto& Value : Block->GetArrayField(TEXT("instructions")))
        {
            if (!Value || Value->Type != EJson::Object) return Fail(TEXT("Invalid instruction object"));
            const auto Instruction = Value->AsObject();
            const FString Id = StringField(Instruction, TEXT("id"));
            if (Id.IsEmpty() || InstructionsById.Contains(Id)) return Fail(TEXT("Missing or duplicate instruction ID: ") + Id);
            InstructionsById.Add(Id, Instruction);
        }
    }
    // Index every producer before validating expressions: block order is not execution order.
    for (const auto& Pair : InstructionsById)
    {
        const auto Instruction = Pair.Value;
        if (StringField(Instruction, TEXT("op")) != TEXT("call-event")) continue;
        if (!Instruction->HasTypedField<EJson::Array>(TEXT("outputs"))) return Fail(TEXT("Missing Event outputs: ") + Pair.Key);
        TMap<FString, TSharedPtr<FJsonObject>> OutputTypes;
        for (const auto& Value : Instruction->GetArrayField(TEXT("outputs")))
        {
            if (!Value || Value->Type != EJson::Object) return Fail(TEXT("Invalid Event output: ") + Pair.Key);
            const auto Output = Value->AsObject();
            const FString Id = StringField(Output, TEXT("id"));
            const auto Type = ObjectField(Output, TEXT("valueType"));
            if (Id.IsEmpty() || OutputTypes.Contains(Id) || !FStoryBlueprintEvaluator::ValidateType(Type)) return Fail(TEXT("Invalid/duplicate Event output ID or type: ") + Pair.Key);
            OutputTypes.Add(Id, Type);
        }
        const auto Mappings = ObjectField(Instruction, TEXT("resultVariableIds"));
        if (!Mappings) return Fail(TEXT("Event resultVariableIds must be an object: ") + Pair.Key);
        for (const auto& Mapping : Mappings->Values)
        {
            if (!Mapping.Value || Mapping.Value->Type != EJson::String) return Fail(TEXT("Invalid Event variable mapping: ") + Pair.Key);
            const auto* OutputType = OutputTypes.Find(Mapping.Key);
            const auto* TargetType = VariableTypes.Find(Mapping.Value->AsString());
            if (!OutputType || !TargetType || !CompatibleTypes(*OutputType, *TargetType)) return Fail(TEXT("Invalid Event output ID, target variable, or mapping type: ") + Pair.Key);
        }
        if (const auto* Definition = EventDefinitions.Find(StringField(Instruction, TEXT("eventId"))))
        {
            const auto Manifest = *Definition;
            if (Manifest->HasField(TEXT("outputs")) && !Manifest->HasTypedField<EJson::Array>(TEXT("outputs"))) return Fail(TEXT("Invalid Event manifest outputs: ") + Pair.Key);
            TSet<FString> Seen;
            if (Manifest->HasTypedField<EJson::Array>(TEXT("outputs")))
                for (const auto& Output : Manifest->GetArrayField(TEXT("outputs")))
                {
                    if (!Output || Output->Type != EJson::Object) return Fail(TEXT("Invalid Event manifest output: ") + Pair.Key);
                    const FString Id = StringField(Output->AsObject(), TEXT("id"));
                    const auto Type = ObjectField(Output->AsObject(), TEXT("valueType"));
                    const auto* Declared = OutputTypes.Find(Id);
                    if (Seen.Contains(Id) || !Declared || !FStoryBlueprintEvaluator::ValidateType(Type) || !CompatibleTypes(Type, *Declared))
                        return Fail(TEXT("Event outputs do not match project manifest: ") + Pair.Key);
                    Seen.Add(Id);
                }
            if (Seen.Num() != OutputTypes.Num()) return Fail(TEXT("Event outputs do not match project manifest: ") + Pair.Key);
        }
    }
    return true;
}

bool FStoryBlueprintRuntime::ValidateText(const TSharedPtr<FJsonObject>& Text) const
{
    auto ValidateParts = [this](const TSharedPtr<FJsonObject>& Variant)
    {
        if (!Variant || !Variant->HasTypedField<EJson::Array>(TEXT("parts"))) return false;
        for (const auto& PartValue : Variant->GetArrayField(TEXT("parts")))
        {
            if (!PartValue || PartValue->Type != EJson::Object) return false;
            const auto Part = PartValue->AsObject();
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
    };
    if (StringField(Text, TEXT("id")).IsEmpty() || !ValidateParts(Text)) return false;
    if (Text->HasField(TEXT("locales")))
    {
        const auto Locales = ObjectField(Text, TEXT("locales"));
        if (!Locales) return false;
        for (const auto& Pair : Locales->Values)
        {
            if (!Pair.Value || Pair.Value->Type != EJson::Object || !ValidateParts(Pair.Value->AsObject())) return false;
        }
    }
    return true;
}

bool FStoryBlueprintRuntime::ValidateProgram()
{
    // The artifact reader has validated the format, exact version, and content version.
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
        if (!FStoryBlueprintEvaluator::ValidateType(Type) || !FStoryBlueprintEvaluator::MatchesType(Variable->TryGetField(TEXT("defaultValue")), Type))
            return Fail(TEXT("Invalid or unsupported variable default type"));
        const FString VariableId = StringField(Variable, TEXT("id"));
        if (VariableTypes.Contains(VariableId)) return Fail(TEXT("Duplicate variable ID"));
        VariableTypes.Add(VariableId, Type);
    }
    if (!IndexProgram()) return false;
    TSet<FString> EventIds;
    TSet<FString> SignalIds;
    const bool bProject = StringField(Artifact.Root, TEXT("format")) == TEXT("story-blueprint-compiled-project");
    if (bProject)
    {
        for (const auto& Event : Artifact.Root->GetArrayField(TEXT("events"))) EventIds.Add(StringField(Event->AsObject(), TEXT("id")));
        for (const auto& Signal : Artifact.Root->GetArrayField(TEXT("signals"))) SignalIds.Add(StringField(Signal->AsObject(), TEXT("id")));
    }
    for (const auto& BlockPair : Blocks->Values)
    {
        if (!BlockPair.Value.IsValid() || BlockPair.Value->Type != EJson::Object)
            return Fail(FString::Printf(TEXT("Invalid block %s"), *BlockPair.Key));
        const TSharedPtr<FJsonObject> Block = BlockPair.Value->AsObject();
        if (StringField(Block, TEXT("id")) != BlockPair.Key) return Fail(TEXT("Block key does not match block ID"));
        if (!Block->HasTypedField<EJson::Array>(TEXT("instructions")))
            return Fail(FString::Printf(TEXT("Missing instructions in %s"), *BlockPair.Key));
        for (const TSharedPtr<FJsonValue>& InstructionValue : Block->GetArrayField(TEXT("instructions")))
        {
            if (!InstructionValue.IsValid() || InstructionValue->Type != EJson::Object)
                return Fail(FString::Printf(TEXT("Invalid instruction in %s"), *BlockPair.Key));
            const TSharedPtr<FJsonObject> Instruction = InstructionValue->AsObject();
            const FString Op = StringField(Instruction, TEXT("op"));
            const FString Id = StringField(Instruction, TEXT("id"));
            if (Op == TEXT("jump"))
            {
                if (!Blocks->HasTypedField<EJson::Object>(StringField(Instruction, TEXT("target"))))
                    return Fail(FString::Printf(TEXT("Invalid jump target at %s"), *Id));
            }
            else if (Op == TEXT("branch"))
            {
                const auto Condition = ObjectField(Instruction, TEXT("condition"));
                if (!ValidateExpression(Condition) || StringField(ObjectField(Condition, TEXT("valueType")), TEXT("kind")) != TEXT("boolean") ||
                    !Blocks->HasTypedField<EJson::Object>(StringField(Instruction, TEXT("whenTrue"))) ||
                    !Blocks->HasTypedField<EJson::Object>(StringField(Instruction, TEXT("whenFalse"))))
                    return Fail(FString::Printf(TEXT("Invalid Branch condition or target at %s"), *Id));
            }
            else if (Op == TEXT("dialogue") || Op == TEXT("narration"))
            {
                if ((Instruction->HasField(TEXT("dynamicSpeaker")) && !ValidateExpression(ObjectField(Instruction, TEXT("dynamicSpeaker")))) ||
                    !ValidateText(ObjectField(Instruction, TEXT("text"))))
                    return Fail(FString::Printf(TEXT("Unsupported text at %s"), *Id));
            }
            else if (Op == TEXT("choice"))
            {
                if (!Instruction->HasTypedField<EJson::Array>(TEXT("options"))) return Fail(TEXT("Choice has no options"));
                if (Instruction->HasField(TEXT("prompt")) && !ValidateText(ObjectField(Instruction, TEXT("prompt"))))
                    return Fail(FString::Printf(TEXT("Unsupported choice prompt at %s"), *Id));
                TSet<FString> OptionIds;
                for (const TSharedPtr<FJsonValue>& OptionValue : Instruction->GetArrayField(TEXT("options")))
                {
                    if (!OptionValue.IsValid() || OptionValue->Type != EJson::Object) return Fail(TEXT("Invalid choice option"));
                    const TSharedPtr<FJsonObject> Option = OptionValue->AsObject();
                    const FString OptionId = StringField(Option, TEXT("id"));
                    if (OptionIds.Contains(OptionId)) return Fail(FString::Printf(TEXT("Duplicate choice ID at %s"), *Id));
                    OptionIds.Add(OptionId);
                    for (const TCHAR* Field : { TEXT("visibleIf"), TEXT("enabledIf") })
                    {
                        if (!Option->HasField(Field)) continue;
                        const auto Condition = ObjectField(Option, Field);
                        if (!ValidateExpression(Condition) || StringField(ObjectField(Condition, TEXT("valueType")), TEXT("kind")) != TEXT("boolean"))
                            return Fail(FString::Printf(TEXT("Invalid choice condition %s at %s"), Field, *Id));
                    }
                    if (StringField(Option, TEXT("id")).IsEmpty() ||
                        !ValidateText(ObjectField(Option, TEXT("text"))) ||
                        !Blocks->HasTypedField<EJson::Object>(StringField(Option, TEXT("target"))))
                        return Fail(FString::Printf(TEXT("Unsupported choice option at %s"), *Id));
                }
            }
            else if (Op == TEXT("set-variable"))
            {
                if (!VariableTypes.Contains(StringField(Instruction, TEXT("variableId"))) || Instruction->HasField(TEXT("containerOperation")) ||
                    !ValidateExpression(ObjectField(Instruction, TEXT("value"))))
                    return Fail(FString::Printf(TEXT("Unsupported assignment at %s"), *Id));
            }
            else if (Op == TEXT("wait-signal"))
            {
                const TSharedPtr<FJsonObject> Matches = ObjectField(Instruction, TEXT("matches"));
                const FString SignalId = StringField(Instruction, TEXT("signalId"));
                if (SignalId.IsEmpty() || (bProject && !SignalIds.Contains(SignalId)))
                    return Fail(FString::Printf(TEXT("Missing Signal declaration at %s"), *Id));
                if (!Matches.IsValid()) return Fail(FString::Printf(TEXT("Missing signal matches at %s"), *Id));
                for (const auto& Pair : Matches->Values)
                {
                    if (!Pair.Value.IsValid() || Pair.Value->Type != EJson::Object || !ValidateExpression(Pair.Value->AsObject()))
                        return Fail(FString::Printf(TEXT("Unsupported signal match at %s"), *Id));
                    if (const auto* Definition = SignalDefinitions.Find(SignalId))
                    {
                        const auto Parameter = NamedParameter(*Definition, Pair.Key);
                        if (!Parameter || !CompatibleTypes(ObjectField(Parameter, TEXT("valueType")), ObjectField(Pair.Value->AsObject(), TEXT("valueType"))))
                            return Fail(TEXT("Signal match does not match project manifest: ") + Id);
                    }
                }
            }
            else if (Op == TEXT("call-event"))
            {
                const TSharedPtr<FJsonObject> Arguments = ObjectField(Instruction, TEXT("arguments"));
                const FString EventId = StringField(Instruction, TEXT("eventId"));
                if (EventId.IsEmpty() || (bProject && !EventIds.Contains(EventId)))
                    return Fail(FString::Printf(TEXT("Missing Event declaration at %s"), *Id));
                if (!Arguments.IsValid() || !Instruction->HasTypedField<EJson::Array>(TEXT("outputs")))
                    return Fail(FString::Printf(TEXT("Invalid event at %s"), *Id));
                for (const auto& Pair : Arguments->Values)
                    if (!Pair.Value.IsValid() || Pair.Value->Type != EJson::Object || !ValidateExpression(Pair.Value->AsObject()))
                        return Fail(FString::Printf(TEXT("Unsupported event argument at %s"), *Id));
                if (Instruction->HasField(TEXT("instanceVariableId"))) return Fail(TEXT("Event instanceVariableId is unsupported: ") + Id);
                if (const auto* Definition = EventDefinitions.Find(EventId))
                {
                    for (const auto& Parameter : (*Definition)->GetArrayField(TEXT("parameters")))
                        if (!Arguments->HasField(StringField(Parameter->AsObject(), TEXT("name"))))
                            return Fail(TEXT("Event is missing a declared argument: ") + Id);
                    for (const auto& Argument : Arguments->Values)
                    {
                        const auto Parameter = NamedParameter(*Definition, Argument.Key);
                        if (!Parameter || !CompatibleTypes(ObjectField(Parameter, TEXT("valueType")), ObjectField(Argument.Value->AsObject(), TEXT("valueType"))))
                            return Fail(TEXT("Event argument does not match project manifest: ") + Id);
                    }
                }
                for (const TSharedPtr<FJsonValue>& OutputValue : Instruction->GetArrayField(TEXT("outputs")))
                {
                    if (!OutputValue.IsValid() || OutputValue->Type != EJson::Object)
                        return Fail(FString::Printf(TEXT("Invalid event output at %s"), *Id));
                    const TSharedPtr<FJsonObject> Output = OutputValue->AsObject();
                    if (StringField(Output, TEXT("id")).IsEmpty() ||
                        !FStoryBlueprintEvaluator::ValidateType(ObjectField(Output, TEXT("valueType"))))
                        return Fail(FString::Printf(TEXT("Unsupported event output at %s"), *Id));
                }
            }
            else if (Op != TEXT("end-story"))
                return Fail(FString::Printf(TEXT("Unsupported instruction %s at %s"), *Op, *Id));
        }
    }
    return true;
}

bool FStoryBlueprintRuntime::StartStory()
{
    if (!Program.IsValid() || !Blocks.IsValid()) return Fail(TEXT("Load a valid story first"));
    if (bStarted) SignalInbox.Empty();
    bStarted = true;
    EventOutputs.Empty();
    SignalOutputs.Empty();
    PendingSignalMatches.Reset();
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
    ChoiceIds.Empty();
    ChoiceTargets.Empty();
    ChoiceTextIds.Empty();
    ChoiceEnabled.Empty();
    LastError.Empty();
    Message.Empty();
    SpeakerId.Empty();
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}

TSharedPtr<FJsonObject> FStoryBlueprintRuntime::CurrentInstruction() const
{
    if (!Blocks.IsValid() || !Blocks->HasTypedField<EJson::Object>(BlockId)) return nullptr;
    const TSharedPtr<FJsonObject> Block = Blocks->GetObjectField(BlockId);
    const TArray<TSharedPtr<FJsonValue>>& Instructions = Block->GetArrayField(TEXT("instructions"));
    if (!Instructions.IsValidIndex(InstructionIndex)) return nullptr;
    return Instructions[InstructionIndex]->AsObject();
}

FString FStoryBlueprintRuntime::GetPendingRequestId() const
{
    return StringField(PendingInstruction, TEXT("id"));
}

FString FStoryBlueprintRuntime::GetPendingSignalId() const
{
    return StringField(PendingInstruction, TEXT("signalId"));
}

FString FStoryBlueprintRuntime::GetPendingSignalMatchesJson() const
{
    return ObjectJson(PendingSignalMatches);
}

bool FStoryBlueprintRuntime::ValidateSignalPayload(const FString& SignalId, const TSharedPtr<FJsonObject>& Payload)
{
    const auto Any = MakeShared<FJsonObject>();
    Any->SetStringField(TEXT("kind"), TEXT("any"));
    if (!FStoryBlueprintEvaluator::MatchesType(MakeShared<FJsonValueObject>(Payload), Any))
        return Fail(TEXT("Signal payload must contain finite JSON values within the nesting limit"));
    const auto* Definition = SignalDefinitions.Find(SignalId);
    if (!Definition)
    {
        if (StringField(Artifact.Root, TEXT("format")) == TEXT("story-blueprint-compiled-project"))
            return Fail(TEXT("Signal is not declared in the project manifest: ") + SignalId);
        return true;
    }
    for (const auto& Parameter : (*Definition)->GetArrayField(TEXT("parameters")))
    {
        const auto Field = Parameter->AsObject();
        const FString Name = StringField(Field, TEXT("name"));
        if (!FStoryBlueprintEvaluator::MatchesType(Payload->TryGetField(Name), ObjectField(Field, TEXT("valueType"))))
            return Fail(FString::Printf(TEXT("Missing or invalid Signal payload field %s/%s"), *SignalId, *Name));
    }
    return true;
}

TSharedPtr<FJsonObject> FStoryBlueprintRuntime::ConsumeSignal(const FString& SignalId, const TSharedPtr<FJsonObject>& Matches)
{
    auto* Queue = SignalInbox.Find(SignalId);
    if (!Queue) return nullptr;
    for (int32 Index = 0; Index < Queue->Num(); ++Index)
    {
        if (!PayloadMatches((*Queue)[Index], Matches)) continue;
        const auto Payload = (*Queue)[Index];
        Queue->RemoveAt(Index);
        if (Queue->Num() == 0) SignalInbox.Remove(SignalId);
        return Payload;
    }
    return nullptr;
}

FString FStoryBlueprintRuntime::GetDebugSnapshotJson() const
{
    const auto Root = MakeShared<FJsonObject>();
    const auto VariableValues = MakeShared<FJsonObject>();
    for (const auto& Pair : Variables) VariableValues->SetField(Pair.Key, Pair.Value);
    Root->SetObjectField(TEXT("variables"), VariableValues);
    for (const auto& Category : { TEXT("eventOutputs"), TEXT("signalOutputs") })
    {
        const auto Values = MakeShared<FJsonObject>();
        const auto& Cache = FString(Category) == TEXT("eventOutputs") ? EventOutputs : SignalOutputs;
        for (const auto& Pair : Cache) Values->SetObjectField(Pair.Key, Pair.Value);
        Root->SetObjectField(Category, Values);
    }
    const auto Inbox = MakeShared<FJsonObject>();
    for (const auto& Pair : SignalInbox)
    {
        TArray<TSharedPtr<FJsonValue>> Queue;
        for (const auto& Payload : Pair.Value) Queue.Add(MakeShared<FJsonValueObject>(Payload));
        Inbox->SetArrayField(Pair.Key, Queue);
    }
    Root->SetObjectField(TEXT("signalInbox"), Inbox);
    return ObjectJson(Root);
}

FStoryBlueprintDialogueRequest FStoryBlueprintRuntime::GetDialogueRequest() const
{
    FStoryBlueprintDialogueRequest Request;
    Request.RequestId = GetPendingRequestId();
    Request.Text = Message;
    Request.SpeakerId = SpeakerId;
    Request.TextId = StringField(ObjectField(PendingInstruction, TEXT("text")), TEXT("id"));
    Request.PortraitId = StringField(PendingInstruction, TEXT("portraitId"));
    Request.Emotion = StringField(PendingInstruction, TEXT("emotion"));
    Request.bNarration = StringField(PendingInstruction, TEXT("op")) == TEXT("narration");
    if (PendingInstruction.IsValid() && PendingInstruction->HasTypedField<EJson::Array>(TEXT("tags")))
        for (const TSharedPtr<FJsonValue>& Tag : PendingInstruction->GetArrayField(TEXT("tags")))
            if (Tag.IsValid() && Tag->Type == EJson::String) Request.Tags.Add(Tag->AsString());
    const TSharedPtr<FJsonObject> Voice = ObjectField(PendingInstruction, TEXT("voice"));
    Request.Voice.DefaultAssetId = StringField(Voice, TEXT("default"));
    const TSharedPtr<FJsonObject> Locales = ObjectField(Voice, TEXT("locales"));
    if (Locales.IsValid())
        for (const auto& Pair : Locales->Values)
            if (Pair.Value.IsValid() && Pair.Value->Type == EJson::String)
                Request.Voice.Locales.Add(Pair.Key, Pair.Value->AsString());
    return Request;
}

FStoryBlueprintChoiceRequest FStoryBlueprintRuntime::GetChoiceRequest() const
{
    FStoryBlueprintChoiceRequest Request;
    Request.RequestId = GetPendingRequestId();
    Request.Prompt = Message;
    Request.PromptTextId = StringField(ObjectField(PendingInstruction, TEXT("prompt")), TEXT("id"));
    for (int32 Index = 0; Index < ChoiceLabels.Num(); ++Index)
    {
        FStoryBlueprintChoice Choice;
        Choice.Id = ChoiceIds.IsValidIndex(Index) ? ChoiceIds[Index] : FString();
        Choice.Text = ChoiceLabels[Index];
        Choice.TextId = ChoiceTextIds.IsValidIndex(Index) ? ChoiceTextIds[Index] : FString();
        Choice.bEnabled = ChoiceEnabled.IsValidIndex(Index) && ChoiceEnabled[Index];
        Request.Options.Add(MoveTemp(Choice));
    }
    return Request;
}

TSharedPtr<FJsonValue> FStoryBlueprintRuntime::Evaluate(const TSharedPtr<FJsonObject>& Expression)
{
    FString Error;
    const auto Value = FStoryBlueprintEvaluator::Evaluate(Expression, Variables, Error, 0,
        [this](const FString& Kind, const FString& Producer, const FString& Output) -> TSharedPtr<FJsonValue>
        {
            const auto* Values = (Kind == TEXT("event-output") ? EventOutputs : SignalOutputs).Find(Producer);
            return Values ? (*Values)->TryGetField(Output) : nullptr;
        });
    if (!Value)
    {
        Fail(FString::Printf(TEXT("Expression error at %s/%s: %s"), *BlockId,
            *StringField(CurrentInstruction(), TEXT("id")), *Error));
    }
    return Value;
}

FString FStoryBlueprintRuntime::RenderText(const TSharedPtr<FJsonObject>& Text)
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
            if (Value->Type != EJson::Null) Result += FStoryBlueprintEvaluator::FormatValue(Value);
        }
    }
    return Result;
}

bool FStoryBlueprintRuntime::MoveTo(const FString& TargetBlock)
{
    if (!Blocks->HasTypedField<EJson::Object>(TargetBlock)) return Fail(TEXT("Invalid block target"));
    BlockId = TargetBlock;
    InstructionIndex = 0;
    return true;
}

bool FStoryBlueprintRuntime::RunUntilPause()
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
        else if (Op == TEXT("branch"))
        {
            const auto Condition = Evaluate(ObjectField(Instruction, TEXT("condition")));
            if (!Condition) return false;
            if (Condition->Type != EJson::Boolean) return Fail(TEXT("Branch condition must be boolean"));
            if (!MoveTo(StringField(Instruction, Condition->AsBool() ? TEXT("whenTrue") : TEXT("whenFalse")))) return false;
        }
        else if (Op == TEXT("set-variable"))
        {
            const FString VariableId = StringField(Instruction, TEXT("variableId"));
            if (!Variables.Contains(VariableId)) return Fail(TEXT("Assignment refers to an unavailable variable"));
            const TSharedPtr<FJsonValue> Value = Evaluate(ObjectField(Instruction, TEXT("value")));
            if (!Value.IsValid()) return false;
            if (!FStoryBlueprintEvaluator::MatchesType(Value, VariableTypes.FindRef(VariableId)))
                return Fail(TEXT("Assignment value does not match the declared variable type"));
            Variables.Add(VariableId, Value);
            ++InstructionIndex;
        }
        else if (Op == TEXT("dialogue") || Op == TEXT("narration"))
        {
            Message = RenderText(ObjectField(Instruction, TEXT("text")));
            if (Phase == EStoryBlueprintPhase::Failed) return false;
            SpeakerId = StringField(Instruction, TEXT("speakerId"));
            if (Instruction->HasField(TEXT("dynamicSpeaker")))
            {
                const auto Speaker = Evaluate(ObjectField(Instruction, TEXT("dynamicSpeaker")));
                if (!Speaker) return false;
                if (Speaker->Type != EJson::String && Speaker->Type != EJson::Null) return Fail(TEXT("Dynamic speaker must resolve to a Character ID string or null"));
                SpeakerId = Speaker->Type == EJson::Null ? FString() : Speaker->AsString();
            }
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Dialogue;
            ++InteractionSequence;
            return true;
        }
        else if (Op == TEXT("choice"))
        {
            ChoiceLabels.Empty();
            ChoiceIds.Empty();
            ChoiceTargets.Empty();
            ChoiceTextIds.Empty();
            ChoiceEnabled.Empty();
            bool bAnyEnabled = false;
            for (const TSharedPtr<FJsonValue>& OptionValue : Instruction->GetArrayField(TEXT("options")))
            {
                const TSharedPtr<FJsonObject> Option = OptionValue->AsObject();
                if (Option->HasField(TEXT("visibleIf")))
                {
                    const auto Visible = Evaluate(ObjectField(Option, TEXT("visibleIf")));
                    if (!Visible) return false;
                    if (Visible->Type != EJson::Boolean) return Fail(TEXT("Choice visibleIf must be boolean"));
                    if (!Visible->AsBool()) continue;
                }
                bool bEnabled = true;
                if (Option->HasField(TEXT("enabledIf")))
                {
                    const auto Enabled = Evaluate(ObjectField(Option, TEXT("enabledIf")));
                    if (!Enabled) return false;
                    if (Enabled->Type != EJson::Boolean) return Fail(TEXT("Choice enabledIf must be boolean"));
                    bEnabled = Enabled->AsBool();
                }
                ChoiceLabels.Add(RenderText(ObjectField(Option, TEXT("text"))));
                if (Phase == EStoryBlueprintPhase::Failed) return false;
                ChoiceIds.Add(StringField(Option, TEXT("id")));
                ChoiceTargets.Add(StringField(Option, TEXT("target")));
                ChoiceTextIds.Add(StringField(ObjectField(Option, TEXT("text")), TEXT("id")));
                ChoiceEnabled.Add(bEnabled);
                bAnyEnabled |= bEnabled;
            }
            if (!bAnyEnabled) return Fail(TEXT("Choice has no visible enabled options"));
            const TSharedPtr<FJsonObject> Prompt = ObjectField(Instruction, TEXT("prompt"));
            Message = Prompt.IsValid() ? RenderText(Prompt) : TEXT("Choose:");
            if (Phase == EStoryBlueprintPhase::Failed) return false;
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Choice;
            ++InteractionSequence;
            return true;
        }
        else if (Op == TEXT("wait-signal"))
        {
            const auto Matches = MakeShared<FJsonObject>();
            for (const auto& Pair : ObjectField(Instruction, TEXT("matches"))->Values)
            {
                const auto Expected = Evaluate(Pair.Value->AsObject());
                if (!Expected) return false;
                Matches->SetField(Pair.Key, Expected);
            }
            const FString SignalId = StringField(Instruction, TEXT("signalId"));
            if (const auto Buffered = ConsumeSignal(SignalId, Matches))
            {
                SignalOutputs.Add(StringField(Instruction, TEXT("id")), Buffered);
                ++InstructionIndex;
                continue;
            }
            PendingSignalMatches = Matches;
            Message = FString::Printf(TEXT("Waiting for signal %s"), *StringField(Instruction, TEXT("signalId")));
            PendingInstruction = Instruction;
            Phase = EStoryBlueprintPhase::Signal;
            ++InteractionSequence;
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
            ++InteractionSequence;
            return true;
        }
        else if (Op == TEXT("end-story"))
        {
            Message = TEXT("Story completed");
            PendingInstruction.Reset();
            Phase = EStoryBlueprintPhase::Completed;
            ++InteractionSequence;
            return true;
        }
        else return Fail(TEXT("Unexpected instruction"));
    }
    return Fail(TEXT("Story exceeded the instruction step limit"));
}

bool FStoryBlueprintRuntime::Advance()
{
    if (Phase != EStoryBlueprintPhase::Dialogue) return false;
    PendingInstruction.Reset();
    ++InstructionIndex;
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}

bool FStoryBlueprintRuntime::CanChooseOption(int32 Index) const
{
    return Phase == EStoryBlueprintPhase::Choice && ChoiceTargets.IsValidIndex(Index) &&
        ChoiceEnabled.IsValidIndex(Index) && ChoiceEnabled[Index];
}

bool FStoryBlueprintRuntime::ChooseOption(int32 Index)
{
    if (!CanChooseOption(Index)) return false;
    const FString Target = ChoiceTargets[Index];
    PendingInstruction.Reset();
    ChoiceLabels.Empty();
    ChoiceIds.Empty();
    ChoiceTargets.Empty();
    ChoiceTextIds.Empty();
    ChoiceEnabled.Empty();
    Phase = EStoryBlueprintPhase::Idle;
    return MoveTo(Target) && RunUntilPause();
}

bool FStoryBlueprintRuntime::SendSignal(const FString& SignalId, const FString& PayloadJson)
{
    if (!Program || SignalId.IsEmpty() || Phase == EStoryBlueprintPhase::Completed || Phase == EStoryBlueprintPhase::Failed) return false;
    TSharedPtr<FJsonObject> Payload;
    if (!ParseObject(PayloadJson, Payload)) return Fail(TEXT("Invalid signal payload JSON"));
    if (!ValidateSignalPayload(SignalId, Payload)) return false;
    if (Phase == EStoryBlueprintPhase::Signal && PendingInstruction &&
        SignalId == StringField(PendingInstruction, TEXT("signalId")) && PayloadMatches(Payload, PendingSignalMatches))
    {
        SignalOutputs.Add(StringField(PendingInstruction, TEXT("id")), Payload);
        PendingSignalMatches.Reset();
        PendingInstruction.Reset();
        ++InstructionIndex;
        Phase = EStoryBlueprintPhase::Idle;
        return RunUntilPause();
    }
    SignalInbox.FindOrAdd(SignalId).Add(Payload);
    return true; // Accepted and buffered; the current interaction may be unchanged.
}

bool FStoryBlueprintRuntime::CompleteEvent(const FString& ResultJson)
{
    if (Phase != EStoryBlueprintPhase::Event || !PendingInstruction.IsValid()) return false;
    TSharedPtr<FJsonObject> Result;
    if (!ParseObject(ResultJson, Result)) return Fail(TEXT("Invalid event result JSON"));
    const auto Declared = MakeShared<FJsonObject>();
    for (const TSharedPtr<FJsonValue>& OutputValue : PendingInstruction->GetArrayField(TEXT("outputs")))
    {
        if (!OutputValue.IsValid() || OutputValue->Type != EJson::Object) return Fail(TEXT("Invalid event output declaration"));
        const TSharedPtr<FJsonObject> Output = OutputValue->AsObject();
        const FString OutputId = StringField(Output, TEXT("id"));
        const TSharedPtr<FJsonObject> Type = ObjectField(Output, TEXT("valueType"));
        if (!FStoryBlueprintEvaluator::MatchesType(Result->TryGetField(OutputId), Type))
            return Fail(FString::Printf(TEXT("Missing or invalid event output %s"), *OutputId));
        Declared->SetField(OutputId, Result->TryGetField(OutputId));
    }
    TMap<FString, TSharedPtr<FJsonValue>> Writes;
    for (const auto& Mapping : ObjectField(PendingInstruction, TEXT("resultVariableIds"))->Values)
    {
        const FString VariableId = Mapping.Value->AsString();
        const auto Value = Declared->TryGetField(Mapping.Key);
        if (!FStoryBlueprintEvaluator::MatchesType(Value, VariableTypes.FindRef(VariableId)))
            return Fail(TEXT("Event output does not match target variable: ") + VariableId);
        Writes.Add(VariableId, Value);
    }
    // Commit only after every output and target has passed validation.
    EventOutputs.Add(StringField(PendingInstruction, TEXT("id")), Declared);
    for (const auto& Write : Writes) Variables.Add(Write.Key, Write.Value);
    PendingInstruction.Reset();
    PendingEventId.Empty();
    PendingEventArgumentsJson.Empty();
    ++InstructionIndex;
    Phase = EStoryBlueprintPhase::Idle;
    return RunUntilPause();
}
