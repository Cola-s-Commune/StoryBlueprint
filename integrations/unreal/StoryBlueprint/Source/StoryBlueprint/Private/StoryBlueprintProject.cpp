#include "StoryBlueprintProject.h"
#include "Dom/JsonValue.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
FString ReadString(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
{
    FString Value;
    if (Object) Object->TryGetStringField(Field, Value);
    return Value;
}

bool ProgramHeader(const TSharedPtr<FJsonObject>& Program)
{
    double Version = 0;
    return Program && ReadString(Program, TEXT("format")) == TEXT("story-runtime") &&
        Program->TryGetNumberField(TEXT("version"), Version) && Version == 7 &&
        !ReadString(Program, TEXT("id")).IsEmpty() && !ReadString(Program, TEXT("contentVersion")).IsEmpty() &&
        Program->HasTypedField<EJson::Object>(TEXT("blocks")) && Program->HasTypedField<EJson::Array>(TEXT("variables"));
}

bool ResourceArray(const TSharedPtr<FJsonObject>& Object, const TCHAR* Field)
{
    if (!Object->HasTypedField<EJson::Array>(Field)) return false;
    TSet<FString> Ids;
    for (const TSharedPtr<FJsonValue>& Value : Object->GetArrayField(Field))
    {
        if (!Value || Value->Type != EJson::Object) return false;
        const FString Id = ReadString(Value->AsObject(), TEXT("id"));
        if (Id.IsEmpty() || Ids.Contains(Id)) return false;
        Ids.Add(Id);
    }
    return true;
}
}

bool FStoryBlueprintProject::Parse(const FString& Json, const FString& RequestedStoryId,
    FStoryBlueprintArtifact& Result, FString& Error)
{
    Result = FStoryBlueprintArtifact();
    Error.Empty();
    FStoryBlueprintArtifact Parsed;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Json);
    auto Reject = [&Error](const FString& Message) { Error = Message; return false; };
    if (!FJsonSerializer::Deserialize(Reader, Parsed.Root) || !Parsed.Root)
        return Reject(TEXT("$: Invalid Story Blueprint JSON object"));
    const FString Format = ReadString(Parsed.Root, TEXT("format"));
    if (Format == TEXT("story-runtime"))
    {
        if (!ProgramHeader(Parsed.Root)) return Reject(TEXT("$: Invalid or unsupported story-runtime@7 header"));
        Parsed.SelectedStoryId = ReadString(Parsed.Root, TEXT("id"));
        if (!RequestedStoryId.IsEmpty() && RequestedStoryId != Parsed.SelectedStoryId)
            return Reject(TEXT("$.id: Standalone program does not match requested Story ID ") + RequestedStoryId);
        Parsed.Program = Parsed.Root;
        Parsed.StoryIds.Add(Parsed.SelectedStoryId);
    }
    else if (Format == TEXT("story-blueprint-compiled-project"))
    {
        double Version = 0;
        if (!Parsed.Root->TryGetNumberField(TEXT("version"), Version) || Version != 1)
            return Reject(TEXT("$.version: Only compiled project version 1 is supported"));
        const FString Entry = ReadString(Parsed.Root, TEXT("entryStoryId"));
        const FString ContentVersion = ReadString(Parsed.Root, TEXT("contentVersion"));
        if (Entry.IsEmpty() || ContentVersion.IsEmpty() || ReadString(Parsed.Root, TEXT("projectId")).IsEmpty() ||
            !Parsed.Root->HasTypedField<EJson::String>(TEXT("name")) ||
            !Parsed.Root->HasTypedField<EJson::String>(TEXT("displayName")) ||
            !Parsed.Root->HasTypedField<EJson::Object>(TEXT("stories")))
            return Reject(TEXT("$: Invalid compiled project header"));
        if (!ResourceArray(Parsed.Root, TEXT("events")) || !ResourceArray(Parsed.Root, TEXT("signals")))
            return Reject(TEXT("$: Invalid events/signals manifest (expected unique IDs)"));
        const TSharedPtr<FJsonObject> Stories = Parsed.Root->GetObjectField(TEXT("stories"));
        if (!Stories->HasTypedField<EJson::Object>(Entry))
            return Reject(TEXT("$.entryStoryId: Entry Story does not exist: ") + Entry);
        Parsed.SelectedStoryId = RequestedStoryId.IsEmpty() ? Entry : RequestedStoryId;
        for (const auto& Pair : Stories->Values)
        {
            const FString Path = TEXT("$.stories.") + Pair.Key;
            if (!Pair.Value || Pair.Value->Type != EJson::Object) return Reject(Path + TEXT(": Expected object"));
            const TSharedPtr<FJsonObject> Story = Pair.Value->AsObject();
            if (ReadString(Story, TEXT("storyId")) != Pair.Key ||
                !Story->HasTypedField<EJson::String>(TEXT("name")) || !Story->HasTypedField<EJson::String>(TEXT("displayName")) ||
                !Story->HasTypedField<EJson::Object>(TEXT("program")) ||
                !ResourceArray(Story, TEXT("characters")) || !ResourceArray(Story, TEXT("assets")))
                return Reject(Path + TEXT(": Invalid Story entry or resource metadata"));
            const TSharedPtr<FJsonObject> Program = Story->GetObjectField(TEXT("program"));
            if (!ProgramHeader(Program)) return Reject(Path + TEXT(".program: Invalid or unsupported runtime header"));
            if (ReadString(Program, TEXT("contentVersion")) != ContentVersion)
                return Reject(Path + TEXT(".program.contentVersion: Does not match project content version"));
            Parsed.StoryIds.Add(Pair.Key);
            if (Pair.Key == Parsed.SelectedStoryId) Parsed.Program = Program;
        }
        if (!Parsed.Program) return Reject(TEXT("$.stories: Requested Story does not exist: ") + Parsed.SelectedStoryId);
        Parsed.StoryIds.Sort();
    }
    else return Reject(TEXT("$.format: Unsupported Story Blueprint artifact format"));
    Result = MoveTemp(Parsed);
    return true;
}
