#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"
#include "Templates/Function.h"

/** Native typed AST operations with host-supplied output validation and readers. */
class STORYBLUEPRINT_API FStoryBlueprintEvaluator
{
public:
    using FOutputValidator = TFunction<bool(const FString&, const FString&, const FString&, const TSharedPtr<FJsonObject>&)>;
    using FOutputReader = TFunction<TSharedPtr<FJsonValue>(const FString&, const FString&, const FString&)>;
    static bool ValidateType(const TSharedPtr<FJsonObject>& Type, int32 Depth = 0);
    static bool MatchesType(const TSharedPtr<FJsonValue>& Value, const TSharedPtr<FJsonObject>& Type, int32 Depth = 0);
    static bool ValidateExpression(const TSharedPtr<FJsonObject>& Expression,
        const TMap<FString, TSharedPtr<FJsonObject>>& VariableTypes, int32 Depth = 0,
        const FOutputValidator& ValidateOutput = FOutputValidator());
    static TSharedPtr<FJsonValue> Evaluate(const TSharedPtr<FJsonObject>& Expression,
        const TMap<FString, TSharedPtr<FJsonValue>>& Variables, FString& Error, int32 Depth = 0,
        const FOutputReader& ReadOutput = FOutputReader());
    static FString FormatValue(const TSharedPtr<FJsonValue>& Value);
};
