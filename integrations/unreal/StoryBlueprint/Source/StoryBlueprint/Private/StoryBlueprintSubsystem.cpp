#include "StoryBlueprintSubsystem.h"

bool UStoryBlueprintSubsystem::LoadStory(const FString& AbsolutePath)
{
    return Runtime.LoadStory(AbsolutePath);
}

bool UStoryBlueprintSubsystem::LoadStoryById(const FString& AbsolutePath, const FString& EntryStoryId)
{
    return Runtime.LoadStory(AbsolutePath, EntryStoryId);
}

bool UStoryBlueprintSubsystem::StartStory()
{
    return Runtime.StartStory();
}

bool UStoryBlueprintSubsystem::Advance()
{
    return Runtime.Advance();
}

bool UStoryBlueprintSubsystem::ChooseOption(int32 Index)
{
    return Runtime.ChooseOption(Index);
}

bool UStoryBlueprintSubsystem::SendSignal(const FString& SignalId, const FString& PayloadJson)
{
    return Runtime.SendSignal(SignalId, PayloadJson);
}

bool UStoryBlueprintSubsystem::CompleteEvent(const FString& ResultJson)
{
    return Runtime.CompleteEvent(ResultJson);
}
