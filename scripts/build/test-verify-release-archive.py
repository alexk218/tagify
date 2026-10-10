"""Archive version checks support eager and lazy esbuild initialization."""
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from zipfile import ZipFile

verify = runpy.run_path(str(Path(__file__).with_name("verify-release-archive.py")))["verify_archive"]

class ArchiveVersionTests(unittest.TestCase):
    def check(self, declaration="var ", package="3.0.0", runtime="3.0.0", backup="3.0.0", filename="tagify-3.0.0.zip"):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / filename
            with ZipFile(archive, "w") as target:
                target.writestr("tagify/package.json", json.dumps({"version": package}))
                for name in ("index.js", "extension.js", "WelcomeModal.js"):
                    target.writestr(f"tagify/{name}", f'{declaration}package_default = {{name: "tagify-secret", version: "{runtime}"}}; {declaration}TAGIFY_BACKUP_EXPORT_VERSION = "{backup}";')
            verify(archive, "3.0.0")

    def test_eager_initialization(self):
        self.check()

    def test_official_stable_filename(self):
        self.check(filename="tagify-v3.0.0.zip")

    def test_lazy_initialization(self):
        self.check(declaration="")

    def test_wrong_package_version(self):
        with self.assertRaises(ValueError):
            self.check(package="2.6.0")

    def test_wrong_lazy_runtime_version(self):
        with self.assertRaises(ValueError):
            self.check(declaration="", runtime="2.6.0")

    def test_wrong_lazy_backup_version(self):
        with self.assertRaises(ValueError):
            self.check(declaration="", backup="2.6.0")

if __name__ == "__main__":
    unittest.main()
