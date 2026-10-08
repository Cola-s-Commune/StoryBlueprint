using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace StoryBlueprint.Runtime
{
    /// <summary>Evaluates the native Blueprint expression and serialized value contracts.</summary>
    public static class StoryEvaluator
    {
        public static JToken Evaluate(JObject expression, Func<string, JToken> readVariable,
            Func<string, string, string, JToken> readOutput = null)
        {
            if (expression == null) throw Error("Expression is missing", "expression");
            string kind = (string)expression["kind"];
            Func<JToken, JToken> evaluate = token => Evaluate(token as JObject, readVariable, readOutput);
            switch (kind)
            {
                case "literal": return expression["value"] ?? JValue.CreateNull();
                case "variable":
                    if (readVariable == null) throw Error("Variable reader is unavailable", expression.Path);
                    return readVariable((string)expression["variableId"]) ?? JValue.CreateNull();
                case "event-output":
                case "substory-output":
                case "signal-output":
                    if (readOutput == null) throw Error(kind + " is unavailable in this context", expression.Path);
                    return readOutput(kind, (string)expression["instructionId"], (string)expression["outputId"]) ?? JValue.CreateNull();
                case "unary":
                {
                    JToken operand = evaluate(expression["operand"]);
                    string op = (string)expression["operator"];
                    if (op == "not") return new JValue(!Boolean(operand, expression.Path));
                    if (op == "negate") return NumberToken(-Number(operand, expression.Path), expression.Path);
                    throw Error("Unsupported unary operator " + op, expression.Path);
                }
                case "binary":
                {
                    string op = (string)expression["operator"];
                    JToken left = evaluate(expression["left"]);
                    if (op == "and") return new JValue(Boolean(left, expression.Path) && Boolean(evaluate(expression["right"]), expression.Path));
                    if (op == "or") return new JValue(Boolean(left, expression.Path) || Boolean(evaluate(expression["right"]), expression.Path));
                    JToken right = evaluate(expression["right"]);
                    switch (op)
                    {
                        case "add":
                            if (left.Type == JTokenType.String && right.Type == JTokenType.String)
                                return new JValue((string)left + (string)right);
                            return NumberToken(Number(left, expression.Path) + Number(right, expression.Path), expression.Path);
                        case "subtract": return NumberToken(Number(left, expression.Path) - Number(right, expression.Path), expression.Path);
                        case "multiply": return NumberToken(Number(left, expression.Path) * Number(right, expression.Path), expression.Path);
                        case "divide": return NumberToken(Number(left, expression.Path) / Number(right, expression.Path), expression.Path);
                        case "modulo": return NumberToken(Number(left, expression.Path) % Number(right, expression.Path), expression.Path);
                        case "equal": return new JValue(StrictEquals(left, right));
                        case "not-equal": return new JValue(!StrictEquals(left, right));
                        case "less-than": return new JValue(Compare(left, right, expression.Path) < 0);
                        case "less-than-or-equal": return new JValue(Compare(left, right, expression.Path) <= 0);
                        case "greater-than": return new JValue(Compare(left, right, expression.Path) > 0);
                        case "greater-than-or-equal": return new JValue(Compare(left, right, expression.Path) >= 0);
                        default: throw Error("Unsupported binary operator " + op, expression.Path);
                    }
                }
                case "member":
                {
                    JToken target = evaluate(expression["target"]);
                    string member = (string)expression["member"];
                    var record = target as JObject;
                    if (record == null || record.Property(member, StringComparison.Ordinal) == null)
                        throw Error("Missing member " + member, expression.Path);
                    return record[member];
                }
                case "index":
                {
                    JToken target = evaluate(expression["target"]);
                    JToken index = evaluate(expression["index"]);
                    var array = target as JArray;
                    if (array != null)
                    {
                        double numeric = Number(index, expression.Path);
                        if (numeric < 0 || numeric >= array.Count || Math.Truncate(numeric) != numeric)
                            throw Error("Array index " + FormatValue(index) + " is out of range", expression.Path);
                        return array[(int)numeric];
                    }
                    var map = target as JObject;
                    if (map == null) throw Error("Expected Array or Map", expression.Path);
                    if (index.Type != JTokenType.String && !IsNumber(index)) throw Error("Map key must be String or Number", expression.Path);
                    string key = FormatValue(index);
                    if (map.Property(key, StringComparison.Ordinal) == null) throw Error("Map key " + key + " does not exist", expression.Path);
                    return map[key];
                }
                case "convert":
                {
                    JToken value = evaluate(expression["target"]);
                    string to = (string)expression["to"]?["kind"];
                    if (to == "string") return new JValue(FormatValue(value));
                    if (to == "number") return NumberToken(ToNumber(value), expression.Path);
                    if (to == "boolean") return new JValue(IsTruthy(value));
                    return value;
                }
                default: throw Error("Unsupported expression " + kind, expression.Path);
            }
        }

        public static bool MatchesType(JToken value, JObject type)
        {
            if (type == null) return false;
            string kind = (string)type["kind"];
            if (value == null || value.Type == JTokenType.Null)
                return kind == "any" || (bool?)type["nullable"] == true;
            switch (kind)
            {
                case "any": return IsJsonValue(value);
                case "boolean": return value.Type == JTokenType.Boolean;
                case "number": return IsNumber(value) && IsFinite((double)value);
                case "string": return value.Type == JTokenType.String;
                case "character-ref": return value.Type == JTokenType.String && IsStableId((string)value, "c");
                case "asset-ref": return value.Type == JTokenType.String && IsStableId((string)value, "a");
                case "json": return IsJsonValue(value);
                case "enum": return value.Type == JTokenType.String && type["values"] is JArray enums && enums.Any(item => item.Type == JTokenType.String && (string)item == (string)value);
                case "array":
                    return value is JArray array && (!(type["elementType"] is JObject elementType) || array.All(item => MatchesType(item, elementType)));
                case "map":
                    if (!(value is JObject map)) return false;
                    string keyType = (string)type["keyType"];
                    JObject itemType = type["valueType"] as JObject;
                    foreach (JProperty property in map.Properties())
                    {
                        if (keyType == "number" && (string.IsNullOrWhiteSpace(property.Name) || !IsFinite(ToNumber(new JValue(property.Name))))) return false;
                        if (keyType == "character-ref" && !IsStableId(property.Name, "c")) return false;
                        if (keyType == "asset-ref" && !IsStableId(property.Name, "a")) return false;
                        if (itemType != null && !MatchesType(property.Value, itemType)) return false;
                    }
                    return true;
                case "struct":
                    if (!(value is JObject record) || !(type["fields"] is JObject fields)) return false;
                    return fields.Properties().All(field => record.Property(field.Name, StringComparison.Ordinal) != null && MatchesType(record[field.Name], field.Value as JObject));
                default: return false;
            }
        }

        /// <summary>Uses JavaScript String(value) formatting, including arrays and opaque objects.</summary>
        public static string FormatValue(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return "null";
            if (value.Type == JTokenType.String) return (string)value;
            if (value.Type == JTokenType.Boolean) return (bool)value ? "true" : "false";
            if (IsNumber(value)) return FormatNumber((double)value);
            if (value is JArray array) return string.Join(",", array.Select(item => item.Type == JTokenType.Null ? "" : FormatValue(item)));
            if (value is JObject) return "[object Object]";
            throw Error("Value is not a JSON runtime value", value.Path);
        }

        public static string Render(JObject template, string locale, JObject program,
            Func<string, JToken> readVariable, Func<string, string, string, JToken> readOutput = null)
        {
            if (template == null) return "";
            JObject variant = SelectLocale(template["locales"] as JObject, locale, program) as JObject;
            JArray parts = (variant ?? template)["parts"] as JArray;
            if (parts == null) throw Error("Text template parts are missing", template.Path);
            var result = new StringBuilder();
            foreach (JObject part in parts)
            {
                if ((string)part["kind"] == "text") result.Append((string)part["value"]);
                else
                {
                    JToken value = Evaluate(part["expression"] as JObject, readVariable, readOutput);
                    if (value != null && value.Type != JTokenType.Null) result.Append(FormatValue(value));
                }
            }
            return result.ToString();
        }

        public static string ResolveVoice(JObject voice, string locale, JObject program)
        {
            if (voice == null) return null;
            JToken selected = SelectLocale(voice["locales"] as JObject, locale, program);
            return (string)(selected ?? voice["default"]);
        }

        public static bool DeepEquals(JToken left, JToken right)
        {
            if (left == null || left.Type == JTokenType.Null) return right == null || right.Type == JTokenType.Null;
            if (right == null || right.Type == JTokenType.Null) return false;
            if (IsNumber(left) && IsNumber(right)) return (double)left == (double)right;
            if (left.Type != right.Type) return false;
            if (left is JArray a && right is JArray b) return a.Count == b.Count && a.Zip(b, DeepEquals).All(equal => equal);
            if (left is JObject x && right is JObject y)
                return x.Count == y.Count && x.Properties().All(property => y.Property(property.Name, StringComparison.Ordinal) != null && DeepEquals(property.Value, y[property.Name]));
            return JToken.DeepEquals(left, right);
        }

        private static bool StrictEquals(JToken left, JToken right)
        {
            if (left is JObject || left is JArray || right is JObject || right is JArray)
                return ReferenceEquals(left, right);
            return DeepEquals(left, right);
        }

        public static bool IsTruthy(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return false;
            if (value.Type == JTokenType.Boolean) return (bool)value;
            if (value.Type == JTokenType.String) return ((string)value).Length != 0;
            if (IsNumber(value)) { double number = (double)value; return number != 0 && !double.IsNaN(number); }
            return true;
        }

        internal static bool IsJsonValue(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null || value.Type == JTokenType.String || value.Type == JTokenType.Boolean) return true;
            if (IsNumber(value)) return IsFinite((double)value);
            if (value is JArray array) return array.All(IsJsonValue);
            if (value is JObject record) return record.Properties().All(property => IsJsonValue(property.Value));
            return false;
        }

        internal static bool IsStableId(string value, string prefix)
        {
            return value != null && Regex.IsMatch(value, "^" + prefix + "_[a-z0-9][a-z0-9_-]{2,}$", RegexOptions.CultureInvariant);
        }

        private static JToken SelectLocale(JObject variants, string locale, JObject program)
        {
            string selected = locale;
            string source = (string)program?["sourceLocale"];
            JObject fallbacks = program?["localeFallbacks"] as JObject;
            var visited = new HashSet<string>(StringComparer.Ordinal);
            while (!string.IsNullOrEmpty(selected) && selected != source && visited.Add(selected))
            {
                JToken variant = variants?[selected];
                if (variant != null && variant.Type != JTokenType.Null) return variant;
                selected = (string)fallbacks?[selected];
            }
            return null;
        }

        private static bool IsNumber(JToken value) { return value != null && (value.Type == JTokenType.Integer || value.Type == JTokenType.Float); }
        private static bool IsFinite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
        private static bool Boolean(JToken value, string path)
        {
            if (value == null || value.Type != JTokenType.Boolean) throw Error("Expected boolean", path);
            return (bool)value;
        }
        private static double Number(JToken value, string path)
        {
            if (!IsNumber(value) || !IsFinite((double)value)) throw Error("Expected finite number", path);
            return (double)value;
        }
        private static JToken NumberToken(double value, string path)
        {
            if (!IsFinite(value)) throw Error("Expression produced a non-finite number", path);
            return new JValue(value);
        }
        private static int Compare(JToken left, JToken right, string path)
        {
            if (left.Type == JTokenType.String && right.Type == JTokenType.String)
                return string.CompareOrdinal((string)left, (string)right);
            return Number(left, path).CompareTo(Number(right, path));
        }
        private static double ToNumber(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return 0;
            if (IsNumber(value)) return (double)value;
            if (value.Type == JTokenType.Boolean) return (bool)value ? 1 : 0;
            string text = FormatValue(value).Trim().Trim('\uFEFF').Trim();
            if (text.Length == 0) return 0;
            if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return ParseRadix(text.Substring(2), 16);
            if (text.StartsWith("0b", StringComparison.OrdinalIgnoreCase)) return ParseRadix(text.Substring(2), 2);
            if (text.StartsWith("0o", StringComparison.OrdinalIgnoreCase)) return ParseRadix(text.Substring(2), 8);
            double number;
            return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out number) ? number : double.NaN;
        }
        private static double ParseRadix(string text, int radix)
        {
            if (text.Length == 0) return double.NaN;
            double number = 0;
            foreach (char character in text)
            {
                int digit = character >= '0' && character <= '9' ? character - '0'
                    : character >= 'a' && character <= 'f' ? character - 'a' + 10
                    : character >= 'A' && character <= 'F' ? character - 'A' + 10 : -1;
                if (digit < 0 || digit >= radix) return double.NaN;
                number = number * radix + digit;
            }
            return number;
        }
        private static string FormatNumber(double value)
        {
            if (value == 0) return "0";
            if (double.IsNaN(value)) return "NaN";
            if (double.IsPositiveInfinity(value)) return "Infinity";
            if (double.IsNegativeInfinity(value)) return "-Infinity";
            string raw = value.ToString("R", CultureInfo.InvariantCulture);
            int exponentAt = raw.IndexOfAny(new[] { 'E', 'e' });
            if (exponentAt < 0) return raw;
            int exponent = int.Parse(raw.Substring(exponentAt + 1), CultureInfo.InvariantCulture);
            string mantissa = raw.Substring(0, exponentAt);
            if (Math.Abs(value) >= 1e-6 && Math.Abs(value) < 1e21)
            {
                bool negative = mantissa.StartsWith("-", StringComparison.Ordinal);
                string unsigned = negative ? mantissa.Substring(1) : mantissa;
                int point = unsigned.IndexOf('.');
                int decimalPosition = (point < 0 ? unsigned.Length : point) + exponent;
                string digits = unsigned.Replace(".", "");
                string expanded = decimalPosition <= 0 ? "0." + new string('0', -decimalPosition) + digits
                    : decimalPosition >= digits.Length ? digits + new string('0', decimalPosition - digits.Length)
                    : digits.Insert(decimalPosition, ".");
                return negative ? "-" + expanded : expanded;
            }
            return mantissa + "e" + (exponent >= 0 ? "+" : "-") + Math.Abs(exponent).ToString(CultureInfo.InvariantCulture);
        }
        private static StoryRuntimeException Error(string message, string path)
        {
            return new StoryRuntimeException("INVALID_EXPRESSION", message, path);
        }
    }
}
