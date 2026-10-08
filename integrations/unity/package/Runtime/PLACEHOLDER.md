The C# Runtime Core and Unity presenter/adapter implementation are the next implementation slice.

Keep the Runtime assembly free of UnityEngine references so it can be tested outside Unity. Unity-specific presenters, main-thread dispatch, asset resolution, and scene lifecycle belong in the Unity assembly.
