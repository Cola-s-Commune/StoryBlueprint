#include "StoryBlueprintEvaluator.h"
#include "Dom/JsonValue.h"
#include <charconv>
#include <cmath>
#include <system_error>

namespace
{
constexpr int32 MaxDepth = 128;

TSharedPtr<FJsonObject> Object(const TSharedPtr<FJsonObject>& Value, const TCHAR* Field)
{
    return Value && Value->HasTypedField<EJson::Object>(Field) ? Value->GetObjectField(Field) : nullptr;
}

FString String(const TSharedPtr<FJsonObject>& Value, const TCHAR* Field)
{
    FString Result;
    if (Value) Value->TryGetStringField(Field, Result);
    return Result;
}

bool StableResourceId(const FString& Id, const TCHAR Prefix)
{
    if (Id.Len() < 5 || Id[0] != Prefix || Id[1] != TEXT('_')) return false;
    for (int32 Index = 2; Index < Id.Len(); ++Index)
    {
        const TCHAR Ch = Id[Index];
        if ((Ch >= TEXT('a') && Ch <= TEXT('z')) || (Ch >= TEXT('0') && Ch <= TEXT('9'))) continue;
        if (Index > 2 && (Ch == TEXT('_') || Ch == TEXT('-'))) continue;
        return false;
    }
    return true;
}

bool IsJson(const TSharedPtr<FJsonValue>& Value, int32 Depth)
{
    if (!Value || Depth > MaxDepth) return false;
    if (Value->Type == EJson::Number) return FMath::IsFinite(Value->AsNumber());
    if (Value->Type == EJson::Array)
    {
        for (const auto& Item : Value->AsArray()) if (!IsJson(Item, Depth + 1)) return false;
        return true;
    }
    if (Value->Type == EJson::Object)
    {
        for (const auto& Pair : Value->AsObject()->Values) if (!IsJson(Pair.Value, Depth + 1)) return false;
        return true;
    }
    return Value->Type == EJson::Null || Value->Type == EJson::Boolean || Value->Type == EJson::String;
}

// ECMAScript Number(string) grammar, with non-finite results rejected by the runtime.
bool ParseNumber(FString Text, double& Result)
{
    Text.TrimStartAndEndInline();
    while (Text.StartsWith(TEXT("\uFEFF"))) Text.RightChopInline(1);
    while (Text.EndsWith(TEXT("\uFEFF"))) Text.LeftChopInline(1);
    Text.TrimStartAndEndInline();
    if (Text.IsEmpty()) { Result = 0; return true; }
    if (Text.Len() > 2 && Text[0] == TEXT('0'))
    {
        const TCHAR Prefix = FChar::ToLower(Text[1]);
        const int32 Radix = Prefix == TEXT('x') ? 16 : Prefix == TEXT('b') ? 2 : Prefix == TEXT('o') ? 8 : 0;
        if (Radix)
        {
            Result = 0;
            for (int32 Index = 2; Index < Text.Len(); ++Index)
            {
                const TCHAR Ch = FChar::ToLower(Text[Index]);
                const int32 Digit = Ch >= TEXT('0') && Ch <= TEXT('9') ? Ch - TEXT('0') :
                    Ch >= TEXT('a') && Ch <= TEXT('f') ? Ch - TEXT('a') + 10 : -1;
                if (Digit < 0 || Digit >= Radix) return false;
                Result = Result * Radix + Digit;
            }
            return FMath::IsFinite(Result);
        }
    }
    if (Text[0] == TEXT('+'))
    {
        Text.RightChopInline(1);
        if (Text.IsEmpty() || Text[0] == TEXT('+') || Text[0] == TEXT('-')) return false;
    }
    if (Text.IsEmpty()) return false;
    const FTCHARToUTF8 Utf8(*Text);
    const auto Parsed = std::from_chars(Utf8.Get(), Utf8.Get() + Utf8.Length(), Result, std::chars_format::general);
    if (Parsed.ptr == Utf8.Get() + Utf8.Length() && Parsed.ec == std::errc::result_out_of_range)
    {
        // from_chars reports both overflow and underflow. JS converts underflow to zero.
        FString Unsigned = Text.StartsWith(TEXT("-")) ? Text.Mid(1) : Text;
        const int32 ExponentAt = Unsigned.Find(TEXT("e"), ESearchCase::IgnoreCase);
        int64 Exponent = 0;
        if (ExponentAt != INDEX_NONE)
        {
            FString ExponentText = Unsigned.Mid(ExponentAt + 1);
            const bool bNegativeExponent = ExponentText.StartsWith(TEXT("-"));
            if (ExponentText.StartsWith(TEXT("-")) || ExponentText.StartsWith(TEXT("+"))) ExponentText.RightChopInline(1);
            for (const TCHAR Digit : ExponentText) Exponent = FMath::Min<int64>(10000000000LL, Exponent * 10 + Digit - TEXT('0'));
            if (bNegativeExponent) Exponent = -Exponent;
            Unsigned = Unsigned.Left(ExponentAt);
        }
        const int32 Point = Unsigned.Find(TEXT("."));
        const int64 DecimalPosition = Point == INDEX_NONE ? Unsigned.Len() : Point;
        Unsigned.ReplaceInline(TEXT("."), TEXT(""));
        int32 FirstNonZero = 0;
        while (FirstNonZero < Unsigned.Len() && Unsigned[FirstNonZero] == TEXT('0')) ++FirstNonZero;
        if (DecimalPosition - FirstNonZero - 1 + Exponent < 0) { Result = 0; return true; }
    }
    return Parsed.ec == std::errc() && Parsed.ptr == Utf8.Get() + Utf8.Length() && FMath::IsFinite(Result);
}

FString NumberText(double Value)
{
    if (Value == 0) return TEXT("0");
    char Buffer[128];
    const auto Result = std::to_chars(Buffer, Buffer + sizeof(Buffer) - 1, Value, std::chars_format::general);
    if (Result.ec != std::errc()) return FString();
    *Result.ptr = '\0';
    FString Raw = UTF8_TO_TCHAR(Buffer);
    const int32 ExponentAt = Raw.Find(TEXT("e"), ESearchCase::IgnoreCase);
    if (ExponentAt == INDEX_NONE) return Raw;
    const int32 Exponent = FCString::Atoi(*Raw.Mid(ExponentAt + 1));
    FString Mantissa = Raw.Left(ExponentAt);
    if (FMath::Abs(Value) >= 1e-6 && FMath::Abs(Value) < 1e21)
    {
        const bool bNegative = Mantissa.StartsWith(TEXT("-"));
        if (bNegative) Mantissa.RightChopInline(1);
        int32 Point = Mantissa.Find(TEXT("."));
        const int32 Position = (Point == INDEX_NONE ? Mantissa.Len() : Point) + Exponent;
        const FString Digits = Mantissa.Replace(TEXT("."), TEXT(""));
        FString Expanded;
        if (Position <= 0) Expanded = TEXT("0.") + FString::ChrN(-Position, TEXT('0')) + Digits;
        else if (Position >= Digits.Len()) Expanded = Digits + FString::ChrN(Position - Digits.Len(), TEXT('0'));
        else Expanded = Digits.Left(Position) + TEXT(".") + Digits.Mid(Position);
        return bNegative ? TEXT("-") + Expanded : Expanded;
    }
    return Mantissa + TEXT("e") + (Exponent >= 0 ? TEXT("+") : TEXT("-")) + FString::FromInt(FMath::Abs(Exponent));
}

bool Truthy(const TSharedPtr<FJsonValue>& Value)
{
    if (!Value || Value->Type == EJson::Null) return false;
    if (Value->Type == EJson::Boolean) return Value->AsBool();
    if (Value->Type == EJson::String) return !Value->AsString().IsEmpty();
    if (Value->Type == EJson::Number) return Value->AsNumber() != 0;
    return true;
}

bool StrictEqual(const TSharedPtr<FJsonValue>& Left, const TSharedPtr<FJsonValue>& Right)
{
    if (Left->Type != Right->Type) return false;
    switch (Left->Type)
    {
    case EJson::Null: return true;
    case EJson::Boolean: return Left->AsBool() == Right->AsBool();
    case EJson::Number: return Left->AsNumber() == Right->AsNumber();
    case EJson::String: return Left->AsString() == Right->AsString();
    default: return Left == Right;
    }
}
}

bool FStoryBlueprintEvaluator::ValidateType(const TSharedPtr<FJsonObject>& Type, int32 Depth)
{
    if (!Type || Depth > MaxDepth || (Type->HasField(TEXT("nullable")) && !Type->HasTypedField<EJson::Boolean>(TEXT("nullable")))) return false;
    const FString Kind = String(Type, TEXT("kind"));
    if (Kind == TEXT("any") || Kind == TEXT("boolean") || Kind == TEXT("number") || Kind == TEXT("string") ||
        Kind == TEXT("character-ref") || Kind == TEXT("asset-ref")) return true;
    if (Kind == TEXT("json")) return !String(Type, TEXT("name")).TrimStartAndEnd().IsEmpty();
    if (Kind == TEXT("enum"))
    {
        if (String(Type, TEXT("name")).IsEmpty() || !Type->HasTypedField<EJson::Array>(TEXT("values")) ||
            Type->GetArrayField(TEXT("values")).Num() == 0) return false;
        for (const auto& Value : Type->GetArrayField(TEXT("values")))
            if (!Value || Value->Type != EJson::String || Value->AsString().IsEmpty()) return false;
        return true;
    }
    if (Kind == TEXT("array"))
        return !Type->HasField(TEXT("elementType")) || ValidateType(Object(Type, TEXT("elementType")), Depth + 1);
    if (Kind == TEXT("map"))
    {
        const FString Key = String(Type, TEXT("keyType"));
        if (Type->HasField(TEXT("keyType")) && Key != TEXT("string") && Key != TEXT("number") &&
            Key != TEXT("character-ref") && Key != TEXT("asset-ref")) return false;
        return !Type->HasField(TEXT("valueType")) || ValidateType(Object(Type, TEXT("valueType")), Depth + 1);
    }
    if (Kind == TEXT("struct"))
    {
        const TSharedPtr<FJsonObject> Fields = Object(Type, TEXT("fields"));
        if (!Fields || String(Type, TEXT("name")).IsEmpty()) return false;
        for (const auto& Pair : Fields->Values)
            if (Pair.Key.IsEmpty() || !Pair.Value || Pair.Value->Type != EJson::Object || !ValidateType(Pair.Value->AsObject(), Depth + 1)) return false;
        return true;
    }
    return false;
}

bool FStoryBlueprintEvaluator::MatchesType(const TSharedPtr<FJsonValue>& Value, const TSharedPtr<FJsonObject>& Type, int32 Depth)
{
    if (!Value || !Type || Depth > MaxDepth) return false;
    const FString Kind = String(Type, TEXT("kind"));
    bool bNullable = false;
    Type->TryGetBoolField(TEXT("nullable"), bNullable);
    if (Value->Type == EJson::Null) return Kind == TEXT("any") || bNullable;
    if (Kind == TEXT("any") || Kind == TEXT("json")) return IsJson(Value, Depth);
    if (Kind == TEXT("number")) return Value->Type == EJson::Number && FMath::IsFinite(Value->AsNumber());
    if (Kind == TEXT("boolean")) return Value->Type == EJson::Boolean;
    if (Kind == TEXT("string")) return Value->Type == EJson::String;
    if (Kind == TEXT("character-ref") || Kind == TEXT("asset-ref"))
        return Value->Type == EJson::String && StableResourceId(Value->AsString(), Kind == TEXT("character-ref") ? TEXT('c') : TEXT('a'));
    if (Kind == TEXT("enum"))
    {
        if (Value->Type != EJson::String || !Type->HasTypedField<EJson::Array>(TEXT("values"))) return false;
        for (const auto& Item : Type->GetArrayField(TEXT("values")))
            if (Item && Item->Type == EJson::String && Item->AsString() == Value->AsString()) return true;
        return false;
    }
    if (Kind == TEXT("array"))
    {
        if (Value->Type != EJson::Array) return false;
        const TSharedPtr<FJsonObject> Element = Object(Type, TEXT("elementType"));
        for (const auto& Item : Value->AsArray())
            if (Element ? !MatchesType(Item, Element, Depth + 1) : !IsJson(Item, Depth + 1)) return false;
        return true;
    }
    if (Kind == TEXT("map"))
    {
        if (Value->Type != EJson::Object) return false;
        const TSharedPtr<FJsonObject> ItemType = Object(Type, TEXT("valueType"));
        const FString KeyType = String(Type, TEXT("keyType"));
        for (const auto& Pair : Value->AsObject()->Values)
        {
            double Number = 0;
            if (KeyType == TEXT("number") && (Pair.Key.TrimStartAndEnd().IsEmpty() || !ParseNumber(Pair.Key, Number))) return false;
            if (KeyType == TEXT("character-ref") && !StableResourceId(Pair.Key, TEXT('c'))) return false;
            if (KeyType == TEXT("asset-ref") && !StableResourceId(Pair.Key, TEXT('a'))) return false;
            if (ItemType ? !MatchesType(Pair.Value, ItemType, Depth + 1) : !IsJson(Pair.Value, Depth + 1)) return false;
        }
        return true;
    }
    if (Kind == TEXT("struct"))
    {
        const TSharedPtr<FJsonObject> Fields = Object(Type, TEXT("fields"));
        if (!Fields || Value->Type != EJson::Object) return false;
        for (const auto& Pair : Fields->Values)
            if (!Pair.Value || Pair.Value->Type != EJson::Object ||
                !MatchesType(Value->AsObject()->TryGetField(Pair.Key), Pair.Value->AsObject(), Depth + 1)) return false;
        return true;
    }
    return false;
}

bool FStoryBlueprintEvaluator::ValidateExpression(const TSharedPtr<FJsonObject>& Expression,
    const TMap<FString, TSharedPtr<FJsonObject>>& VariableTypes, int32 Depth, const FOutputValidator& ValidateOutput)
{
    if (!Expression || Depth > MaxDepth || !ValidateType(Object(Expression, TEXT("valueType")))) return false;
    auto Child = [&](const TCHAR* Field) { return ValidateExpression(Object(Expression, Field), VariableTypes, Depth + 1, ValidateOutput); };
    auto ChildKind = [&](const TCHAR* Field) { return String(Object(Object(Expression, Field), TEXT("valueType")), TEXT("kind")); };
    const FString Kind = String(Expression, TEXT("kind"));
    const FString ResultKind = String(Object(Expression, TEXT("valueType")), TEXT("kind"));
    const FString Op = String(Expression, TEXT("operator"));
    if (Kind == TEXT("literal")) return MatchesType(Expression->TryGetField(TEXT("value")), Object(Expression, TEXT("valueType")));
    if (Kind == TEXT("variable")) return VariableTypes.Contains(String(Expression, TEXT("variableId")));
    if (Kind == TEXT("event-output") || Kind == TEXT("signal-output"))
        return ValidateOutput && ValidateOutput(Kind, String(Expression, TEXT("instructionId")),
            String(Expression, TEXT("outputId")), Object(Expression, TEXT("valueType")));
    if (Kind == TEXT("unary"))
        return Child(TEXT("operand")) && ((Op == TEXT("not") && ChildKind(TEXT("operand")) == TEXT("boolean") && ResultKind == TEXT("boolean")) ||
            (Op == TEXT("negate") && ChildKind(TEXT("operand")) == TEXT("number") && ResultKind == TEXT("number")));
    if (Kind == TEXT("binary"))
    {
        if (!Child(TEXT("left")) || !Child(TEXT("right"))) return false;
        const FString Left = ChildKind(TEXT("left"));
        const FString Right = ChildKind(TEXT("right"));
        if (Op == TEXT("and") || Op == TEXT("or")) return Left == TEXT("boolean") && Right == Left && ResultKind == TEXT("boolean");
        if (Op == TEXT("equal") || Op == TEXT("not-equal")) return ResultKind == TEXT("boolean");
        if (Op == TEXT("less-than") || Op == TEXT("less-than-or-equal") || Op == TEXT("greater-than") || Op == TEXT("greater-than-or-equal"))
            return Left == Right && (Left == TEXT("number") || Left == TEXT("string")) && ResultKind == TEXT("boolean");
        if (Op == TEXT("add") && Left == TEXT("string") && Right == Left) return ResultKind == TEXT("string");
        if (Op == TEXT("add") || Op == TEXT("subtract") || Op == TEXT("multiply") || Op == TEXT("divide") || Op == TEXT("modulo"))
            return Left == TEXT("number") && Right == Left && ResultKind == TEXT("number");
        return false;
    }
    if (Kind == TEXT("member")) return Child(TEXT("target")) && ChildKind(TEXT("target")) != TEXT("json") && !String(Expression, TEXT("member")).IsEmpty();
    if (Kind == TEXT("index")) return Child(TEXT("target")) && ChildKind(TEXT("target")) != TEXT("json") && Child(TEXT("index"));
    if (Kind == TEXT("convert")) return Child(TEXT("target")) && ValidateType(Object(Expression, TEXT("to"))) &&
        String(Object(Expression, TEXT("to")), TEXT("kind")) == ResultKind;
    return false;
}

FString FStoryBlueprintEvaluator::FormatValue(const TSharedPtr<FJsonValue>& Value)
{
    if (!Value || Value->Type == EJson::Null) return TEXT("null");
    if (Value->Type == EJson::String) return Value->AsString();
    if (Value->Type == EJson::Boolean) return Value->AsBool() ? TEXT("true") : TEXT("false");
    if (Value->Type == EJson::Number) return NumberText(Value->AsNumber());
    if (Value->Type == EJson::Array)
    {
        TArray<FString> Parts;
        for (const auto& Item : Value->AsArray()) Parts.Add(Item && Item->Type != EJson::Null ? FormatValue(Item) : FString());
        return FString::Join(Parts, TEXT(","));
    }
    return TEXT("[object Object]");
}

TSharedPtr<FJsonValue> FStoryBlueprintEvaluator::Evaluate(const TSharedPtr<FJsonObject>& Expression,
    const TMap<FString, TSharedPtr<FJsonValue>>& Variables, FString& Error, int32 Depth, const FOutputReader& ReadOutput)
{
    auto Reject = [&Error](const FString& Message) -> TSharedPtr<FJsonValue> { Error = Message; return nullptr; };
    if (!Error.IsEmpty()) return nullptr;
    if (!Expression || Depth > MaxDepth) return Reject(TEXT("Missing expression or expression depth limit exceeded"));
    const FString Kind = String(Expression, TEXT("kind"));
    const FString Op = String(Expression, TEXT("operator"));
    auto Child = [&](const TCHAR* Field) { return Evaluate(Object(Expression, Field), Variables, Error, Depth + 1, ReadOutput); };
    auto Number = [&](double Value) -> TSharedPtr<FJsonValue>
    {
        if (!FMath::IsFinite(Value)) return Reject(TEXT("Expression produced a non-finite number"));
        return MakeShared<FJsonValueNumber>(Value);
    };
    TSharedPtr<FJsonValue> Result;
    if (Kind == TEXT("literal")) Result = Expression->TryGetField(TEXT("value"));
    else if (Kind == TEXT("variable"))
    {
        const auto* Found = Variables.Find(String(Expression, TEXT("variableId")));
        if (!Found) return Reject(TEXT("Expression refers to an unavailable variable"));
        Result = *Found;
    }
    else if (Kind == TEXT("event-output") || Kind == TEXT("signal-output"))
    {
        const FString InstructionId = String(Expression, TEXT("instructionId"));
        const FString OutputId = String(Expression, TEXT("outputId"));
        if (ReadOutput) Result = ReadOutput(Kind, InstructionId, OutputId);
        if (!Result) return Reject(FString::Printf(TEXT("%s %s/%s is not available (producer has not completed or payload field is missing)"), *Kind, *InstructionId, *OutputId));
    }
    else if (Kind == TEXT("unary"))
    {
        const auto Operand = Child(TEXT("operand"));
        if (!Operand) return nullptr;
        if (Op == TEXT("not") && Operand->Type == EJson::Boolean) Result = MakeShared<FJsonValueBoolean>(!Operand->AsBool());
        else if (Op == TEXT("negate") && Operand->Type == EJson::Number) Result = Number(-Operand->AsNumber());
        else return Reject(TEXT("Invalid unary operator or operand type"));
    }
    else if (Kind == TEXT("binary"))
    {
        const auto Left = Child(TEXT("left"));
        if (!Left) return nullptr;
        if (Op == TEXT("and") || Op == TEXT("or"))
        {
            if (Left->Type != EJson::Boolean) return Reject(TEXT("Logical operand must be boolean"));
            const bool bLeft = Left->AsBool();
            if ((Op == TEXT("and") && !bLeft) || (Op == TEXT("or") && bLeft)) Result = MakeShared<FJsonValueBoolean>(bLeft);
            else
            {
                Result = Child(TEXT("right"));
                if (!Result) return nullptr;
                if (Result->Type != EJson::Boolean) return Reject(TEXT("Logical operand must be boolean"));
            }
        }
        else
        {
            const auto Right = Child(TEXT("right"));
            if (!Right) return nullptr;
            if (Op == TEXT("equal") || Op == TEXT("not-equal"))
                Result = MakeShared<FJsonValueBoolean>(StrictEqual(Left, Right) == (Op == TEXT("equal")));
            else if (Op == TEXT("add") && Left->Type == EJson::String && Right->Type == EJson::String)
                Result = MakeShared<FJsonValueString>(Left->AsString() + Right->AsString());
            else if (Op == TEXT("less-than") || Op == TEXT("less-than-or-equal") || Op == TEXT("greater-than") || Op == TEXT("greater-than-or-equal"))
            {
                int32 Comparison = 0;
                if (Left->Type == EJson::String && Right->Type == EJson::String) Comparison = Left->AsString().Compare(Right->AsString(), ESearchCase::CaseSensitive);
                else if (Left->Type == EJson::Number && Right->Type == EJson::Number)
                    Comparison = Left->AsNumber() < Right->AsNumber() ? -1 : Left->AsNumber() > Right->AsNumber() ? 1 : 0;
                else return Reject(TEXT("Comparison requires two numbers or two strings"));
                const bool bValue = Op == TEXT("less-than") ? Comparison < 0 : Op == TEXT("less-than-or-equal") ? Comparison <= 0 :
                    Op == TEXT("greater-than") ? Comparison > 0 : Comparison >= 0;
                Result = MakeShared<FJsonValueBoolean>(bValue);
            }
            else
            {
                if (Left->Type != EJson::Number || Right->Type != EJson::Number) return Reject(TEXT("Arithmetic operands must be numbers"));
                const double A = Left->AsNumber(), B = Right->AsNumber();
                if ((Op == TEXT("divide") || Op == TEXT("modulo")) && B == 0) return Reject(TEXT("Division or modulo by zero"));
                if (Op == TEXT("add")) Result = Number(A + B);
                else if (Op == TEXT("subtract")) Result = Number(A - B);
                else if (Op == TEXT("multiply")) Result = Number(A * B);
                else if (Op == TEXT("divide")) Result = Number(A / B);
                else if (Op == TEXT("modulo")) Result = Number(std::fmod(A, B));
                else return Reject(TEXT("Unsupported binary operator"));
            }
        }
    }
    else if (Kind == TEXT("member") || Kind == TEXT("index"))
    {
        const auto Target = Child(TEXT("target"));
        if (!Target) return nullptr;
        if (Kind == TEXT("member"))
        {
            if (Target->Type != EJson::Object) return Reject(TEXT("Member target must be an object"));
            Result = Target->AsObject()->TryGetField(String(Expression, TEXT("member")));
        }
        else
        {
            const auto Index = Child(TEXT("index"));
            if (!Index) return nullptr;
            if (Target->Type == EJson::Array)
            {
                if (Index->Type != EJson::Number) return Reject(TEXT("Array index must be a number"));
                const double Numeric = Index->AsNumber();
                if (Numeric < 0 || Numeric >= Target->AsArray().Num() || std::trunc(Numeric) != Numeric)
                    return Reject(TEXT("Array index is out of range"));
                Result = Target->AsArray()[static_cast<int32>(Numeric)];
            }
            else
            {
                if (Target->Type != EJson::Object || (Index->Type != EJson::String && Index->Type != EJson::Number))
                    return Reject(TEXT("Map lookup requires an object and a String or Number key"));
                Result = Target->AsObject()->TryGetField(FormatValue(Index));
            }
        }
        if (!Result) return Reject(TEXT("Missing member or Map key"));
    }
    else if (Kind == TEXT("convert"))
    {
        const auto Target = Child(TEXT("target"));
        if (!Target) return nullptr;
        const FString To = String(Object(Expression, TEXT("to")), TEXT("kind"));
        if (To == TEXT("string")) Result = MakeShared<FJsonValueString>(FormatValue(Target));
        else if (To == TEXT("boolean")) Result = MakeShared<FJsonValueBoolean>(Truthy(Target));
        else if (To == TEXT("number"))
        {
            if (Target->Type == EJson::Null) Result = Number(0);
            else if (Target->Type == EJson::Boolean) Result = Number(Target->AsBool() ? 1 : 0);
            else if (Target->Type == EJson::Number) Result = Target;
            else
            {
                double Converted = 0;
                if (!ParseNumber(FormatValue(Target), Converted)) return Reject(TEXT("Number conversion did not produce a finite number"));
                Result = Number(Converted);
            }
        }
        else Result = Target;
    }
    else return Reject(TEXT("Unsupported expression kind: ") + Kind);
    if (!Result) return nullptr;
    if (!MatchesType(Result, Object(Expression, TEXT("valueType"))))
        return Reject(TEXT("Expression result does not match its declared valueType"));
    return Result;
}
