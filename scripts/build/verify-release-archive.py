"""Check release ZIP labels against the canonical package version (no dependencies)."""

import argparse
import json
from pathlib import Path
import re
import sys
from zipfile import BadZipFile, ZipFile


def verify_archive(path: Path, expected: str) -> None:
    if not re.fullmatch(r"tagify-" + re.escape(expected) + r"(?:-metadata-corrected)?\.zip", path.name):
        raise ValueError(f"Archive filename must identify {expected}")
    with ZipFile(path) as archive:
        if archive.testzip() is not None:
            raise ValueError("Archive contains a corrupt entry")
        package = json.loads(archive.read("tagify/package.json"))
        if package["version"] != expected:
            raise ValueError(f"Package version is {package['version']}, expected {expected}")
        for name in ("index.js", "extension.js", "WelcomeModal.js"):
            source = archive.read(f"tagify/{name}").decode("utf-8")
            versions = re.findall(
                r'var package_default\s*=\s*\{\s*name:\s*"tagify-secret",\s*version:\s*"([^"]+)"',
                source,
            )
            if versions != [expected]:
                raise ValueError(f"{name} embeds {versions or 'no recognizable package version'}, expected {expected}")
            backup_versions = re.findall(r'var TAGIFY_BACKUP_EXPORT_VERSION\s*=\s*"([^"]+)"', source)
            if any(version != expected for version in backup_versions):
                raise ValueError(f"{name} contains stale backup version metadata")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--version", help="Historical version; defaults to this checkout's package version")
    args = parser.parse_args()
    expected = args.version or json.loads((Path(__file__).resolve().parents[2] / "package.json").read_text())["version"]
    try:
        verify_archive(args.archive, expected)
    except (ValueError, KeyError, OSError, BadZipFile) as error:
        print(f"Archive verification failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"Verified {args.archive.name}: package and runtime labels are {expected}")
