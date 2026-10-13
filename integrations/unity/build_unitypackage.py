"""Build the Assets-based demo import from the UPM sources and Unity's Newtonsoft package."""

from __future__ import annotations

import io
import re
import tarfile
import uuid
from pathlib import Path


HERE = Path(__file__).resolve().parent
PACKAGE = HERE / "package"
NEWTONSOFT = (
    HERE
    / "samples/RuntimeDemo/Library/PackageCache/com.unity.nuget.newtonsoft-json@3.2.1"
)
OUTPUT = HERE / "StoryBlueprintRuntimeDemo.unitypackage"
ROOT = "Assets/StoryBlueprint"
GUID_NAMESPACE = uuid.UUID("c1311a3c-5f63-4b40-8128-21d9e8abce29")


def generated_guid(path: str) -> str:
    return uuid.uuid5(GUID_NAMESPACE, path).hex


def generated_meta(path: str, folder: bool = False) -> bytes:
    kind = "folderAsset: yes\nDefaultImporter:\n" if folder else "DefaultImporter:\n"
    return (
        f"fileFormatVersion: 2\nguid: {generated_guid(path)}\n{kind}"
        "  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n"
    ).encode("utf-8")


def add_entry(entries: dict[str, tuple[bytes | None, bytes]], path: str,
              source: Path | None = None, *, folder: bool = False,
              content: bytes | None = None) -> None:
    meta_path = Path(str(source) + ".meta") if source else None
    meta = meta_path.read_bytes() if meta_path and meta_path.is_file() else generated_meta(path, folder)
    if source and not meta_path.is_file():
        raise FileNotFoundError(meta_path)
    if path in entries:
        raise ValueError(f"Duplicate package path: {path}")
    entries[path] = (None if folder else content if content is not None else source.read_bytes(), meta)


def add_tree(entries: dict[str, tuple[bytes | None, bytes]], source: Path, destination: str) -> None:
    add_entry(entries, destination, source, folder=True)
    for item in sorted(source.rglob("*")):
        if item.name.endswith(".meta"):
            continue
        path = destination + "/" + item.relative_to(source).as_posix()
        add_entry(entries, path, item, folder=item.is_dir())


def write_member(archive: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = 0
    info.mode = 0o644
    archive.addfile(info, io.BytesIO(data))


def main() -> None:
    entries: dict[str, tuple[bytes | None, bytes]] = {}
    add_entry(entries, ROOT, folder=True)
    add_tree(entries, PACKAGE / "Runtime", ROOT + "/Runtime")
    add_tree(entries, PACKAGE / "Editor", ROOT + "/Editor")

    third_party = ROOT + "/ThirdParty"
    for path in (third_party, third_party + "/Newtonsoft.Json", third_party + "/Newtonsoft.Json/Runtime",
                 third_party + "/Newtonsoft.Json/Runtime/AOT"):
        add_entry(entries, path, folder=True)
    for source, destination in (
        ("Runtime/Newtonsoft.Json.dll", "Runtime/Newtonsoft.Json.dll"),
        ("Runtime/AOT/Newtonsoft.Json.dll", "Runtime/AOT/Newtonsoft.Json.dll"),
        ("link.xml", "link.xml"),
        ("LICENSE.md", "LICENSE.md"),
    ):
        add_entry(entries, third_party + "/Newtonsoft.Json/" + destination, NEWTONSOFT / source)

    instructions = (
        "Story Blueprint Runtime Demo (Unity 2022.3 LTS)\n\n"
        "Open Runtime/Demo/SBDemoScene.unity or drag StoryBlueprintRuntimeDemo.prefab into a scene.\n"
        "The Canvas, panels, labels, and buttons are editable in the Prefab editor.\n"
        "The included Newtonsoft.Json DLLs are from com.unity.nuget.newtonsoft-json 3.2.1.\n"
        "If your project already installs that UPM package, uncheck ThirdParty/Newtonsoft.Json\n"
        "during import to avoid duplicate assemblies. Install com.unity.ugui 1.0.0 if needed.\n"
        "Import into a project without an existing Assets/StoryBlueprint folder, or merge deliberately.\n"
    )
    add_entry(entries, ROOT + "/README.txt", content=instructions.encode("utf-8"))

    guids: set[str] = set()
    for path, (_, meta) in entries.items():
        match = re.search(rb"^guid: ([0-9a-f]{32})\r?$", meta, re.MULTILINE)
        if not match:
            raise ValueError(f"Missing GUID: {path}")
        guid = match.group(1).decode("ascii")
        if guid in guids:
            raise ValueError(f"Duplicate GUID: {path}")
        guids.add(guid)

    with tarfile.open(OUTPUT, "w:gz", format=tarfile.GNU_FORMAT) as archive:
        for path, (asset, meta) in sorted(entries.items()):
            guid = re.search(rb"^guid: ([0-9a-f]{32})\r?$", meta, re.MULTILINE).group(1).decode("ascii")
            directory = tarfile.TarInfo(guid + "/")
            directory.type = tarfile.DIRTYPE
            directory.mode = 0o755
            directory.mtime = 0
            archive.addfile(directory)
            if asset is not None:
                write_member(archive, guid + "/asset", asset)
            write_member(archive, guid + "/asset.meta", meta)
            write_member(archive, guid + "/pathname", path.encode("utf-8"))
    print(f"Wrote {OUTPUT} with {len(entries)} assets and folders")


if __name__ == "__main__":
    main()
