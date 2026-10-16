#include "StoryBlueprintAdapter.h"

void UStoryBlueprintAdapter::RegisterEvent(const FString& EventId, FEventHandler Handler)
{
    if (!EventId.IsEmpty() && Handler) EventHandlers.Add(EventId, MoveTemp(Handler));
}

bool UStoryBlueprintAdapter::TryHandleEvent(const FStoryBlueprintEventRequest& Request, FString& ResultJson) const
{
    const FEventHandler* Handler = EventHandlers.Find(Request.EventId);
    return Handler && (*Handler)(Request, ResultJson);
}
