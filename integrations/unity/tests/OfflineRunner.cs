using System;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using StoryBlueprint.Runtime.Tests;

// Unity supplies NUnit; this runner only needs its discovery attribute to reuse the same tests.
namespace NUnit.Framework
{
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class TestAttribute : Attribute { }
}

internal static class OfflineRunner
{
    private static async Task<int> Main(string[] args)
    {
        var filter = args.Length == 0 ? "" : args[0];
        var methods = typeof(StoryRuntimeTests).GetMethods()
            .Where(method => method.GetCustomAttribute<NUnit.Framework.TestAttribute>() != null)
            .Where(method => method.Name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0)
            .OrderBy(method => method.Name).ToArray();
        if (methods.Length == 0)
        {
            Console.Error.WriteLine("No tests match " + filter);
            return 2;
        }
        var failures = 0;
        foreach (var method in methods)
        {
            try
            {
                var result = method.Invoke(new StoryRuntimeTests(), null);
                if (result is Task task) await task;
                Console.WriteLine("PASS " + method.Name);
            }
            catch (Exception error)
            {
                failures++;
                Console.Error.WriteLine("FAIL " + method.Name + ": " +
                    (error is TargetInvocationException invocation ? invocation.InnerException : error));
            }
        }
        Console.WriteLine($"{methods.Length - failures}/{methods.Length} native runtime tests passed.");
        return failures == 0 ? 0 : 1;
    }
}
