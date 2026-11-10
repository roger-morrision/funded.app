import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).parents[1] / 'scripts/devnet-backup-restore.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupArchiveTests(unittest.TestCase):
    def test_archives_cannot_escape_or_link_to_live_data(self):
        for name, kind in [('../outside', tarfile.REGTYPE), ('/absolute', tarfile.REGTYPE),
                           ('..\\outside', tarfile.REGTYPE), ('C:/outside', tarfile.REGTYPE),
                           ('ledger', tarfile.SYMTYPE), ('ledger', tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                archive = root / 'test.tar'
                with tarfile.open(archive, 'w') as stream:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    item.linkname = '/live'
                    stream.addfile(item)
                with self.assertRaises(ValueError):
                    backup.safe_extract(archive, root / 'restored')

    def test_hashes_match_restored_files_and_refuse_unfinished_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'source'
            source.mkdir()
            (source / 'ledger.json').write_text('{"version":2}')
            archive = root / 'test.tar'
            with tarfile.open(archive, 'w') as stream:
                stream.add(source / 'ledger.json', arcname='ledger.json')
            target = root / 'restore'
            backup.safe_extract(archive, target)
            self.assertEqual(backup.tree_manifest(source), backup.tree_manifest(target))
            (source / 'ledger.json.lock').touch()
            with self.assertRaises(ValueError):
                backup.tree_manifest(source)


if __name__ == '__main__':
    unittest.main()
