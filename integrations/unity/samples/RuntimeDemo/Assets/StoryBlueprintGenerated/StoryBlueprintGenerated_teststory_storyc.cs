using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json.Linq;
using StoryBlueprint.Runtime;
using StoryBlueprint.Unity;

// Generated from a Story Blueprint story JSON. Fill in each External Function handler.
[GeneratedStoryHost]
public sealed class StoryBlueprintGenerated_teststory_storyc : UnityStoryHost
{
    private const string ExternalFunctionId_TestFunc1 = "ev_50ftx814c1126";
    private const string ExternalFunctionOutputId_Handle_TestFunc1_Ret1 = "evo_3z9v5p2b5kvqy";
    private const string SignalId_Signal1 = "sig_djd6fnvkb0ed5";

    private static JToken ToToken(object value)
    {
        if (value == null) return JValue.CreateNull();
        var token = value as JToken;
        return token == null ? JToken.FromObject(value) : token.DeepClone();
    }

    protected override void ConfigureAdapter(UnityStoryAdapter adapter)
    {
        base.ConfigureAdapter(adapter);
        adapter.RegisterExternalFunction(ExternalFunctionId_TestFunc1, async (request, cancellationToken) =>
        {
            var result = await Handle_TestFunc1(request.Arguments.Value<double>("Pram1"), cancellationToken);
            return new JObject
            {
                [ExternalFunctionOutputId_Handle_TestFunc1_Ret1] = ToToken(result)
            };
        });
    }

    private Task<string> Handle_TestFunc1(double Pram1, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        // External Function: TestFunc1
        // Input: Pram1 (double)
        // Return: string for Ret1.
        // TODO: Perform the game action and return its typed value.
        // Example: return Task.FromResult(default(string)); // Replace default(...) with the real result.
        return Task.FromResult($"Pram1 = {Pram1}");
        throw new NotImplementedException("Implement External Function TestFunc1");
    }

    // Call this when the game observes Signal Signal1.
    public void SendSignal_Signal1(string Param2)
    {
        var payload = new JObject();
        payload["Param2"] = JToken.FromObject(Param2);
        SendSignal(SignalId_Signal1, payload);
    }
}
