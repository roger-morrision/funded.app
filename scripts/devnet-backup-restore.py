"""Create and restore-test a quiesced Devnet backup. Never restore into live data.

Run on the existing Linux Docker host with an explicit private Compose JSON file
and a new private output directory. Credentials and database contents are never
printed. The app/workers pause briefly so the database, reward ledger and signer
journal describe the same stopped state. Services restart even on failure.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import tarfile
import time
import traceback

WRITERS = ['fee-collector', 'buyback-worker', 'agency-buyback-worker', 'app', 'price-signer']


def run(args, **kwargs):
    return subprocess.check_output(args, stderr=subprocess.PIPE, **kwargs)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def tree_manifest(root):
    if not root.is_dir() or root.is_symlink():
        raise ValueError('Backup root must be a regular directory')
    result = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Backup input contains a symbolic link')
        if path.is_file():
            if path.name.endswith('.lock') or path.name.endswith('.tmp'):
                raise ValueError('Unresolved ledger lock or temporary write; investigate before backup')
            result[path.relative_to(root).as_posix()] = digest(path)
        elif not path.is_dir():
            raise ValueError('Backup input contains a non-regular file')
    return result


def safe_extract(archive, target):
    with tarfile.open(archive) as source:
        seen = set()
        for item in source.getmembers():
            name = PurePosixPath(item.name)
            if (name.is_absolute() or '..' in name.parts or '\\' in item.name
                    or ':' in item.name or item.name in seen or not (item.isfile() or item.isdir())):
                raise ValueError('Unsafe backup archive member')
            seen.add(item.name)
        source.extractall(target, filter='data')


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def create_backup(compose_path, output):
    import fcntl  # Host operation is Linux-only; pure archive checks are portable.
    os.umask(0o077)
    cfg = json.loads(compose_path.read_text())
    project = cfg.get('name', 'richpad-devnet')
    assert project == 'richpad-devnet', 'Select the existing remote Devnet project'
    env = cfg['services']['app']['environment']
    assert env['SOLANA_CLUSTER'] == 'devnet' and env['VITE_ALLOW_MAINNET'] == 'false'
    assert cfg['volumes']['funded_reward_ledger']['name'] == 'richpad_primary_funded_reward_ledger_active'
    assert cfg['volumes']['funded_vip_pgdata']['name'] == 'richpad_primary_funded_vip_pgdata_active'
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    compose = ['docker', 'compose', '--project-name', project, '-f', str(compose_path)]
    lock = open(compose_path.parent / 'backup.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    names = {s: project + '-' + s + '-1' for s in WRITERS + ['db']}
    before = {s: inspect(n) for s, n in names.items()}
    revision = env['FUNDED_BUILD_ID']
    for service in WRITERS:
        item = before[service]
        assert item['State']['Running'] and item['State'].get('Health', {}).get('Status') == 'healthy'
        assert item['Config']['Labels']['org.opencontainers.image.revision'] == revision
        if service != 'price-signer':
            assert 'SOLANA_CLUSTER=devnet' in item['Config']['Env']
    mounts = {}
    for service in WRITERS:
        for mount in before[service]['Mounts']:
            if not mount['RW']:
                continue
            assert (service == 'app' and mount['Destination'] == '/app/data/automatic-rewards'
                    or service == 'price-signer' and mount['Destination'] == '/state'), 'Unreviewed writable mount'
            mounts[service] = Path(mount['Source'])
    assert set(mounts) == {'app', 'price-signer'}, 'Reward ledger and signer journal must both be backed up'
    assert 'PRICE_SIGNER_JOURNAL=/state/reservations.jsonl' in before['price-signer']['Config']['Env']
    report = {'schemaVersion': 1, 'cluster': 'devnet', 'revision': revision,
              'status': 'in-progress', 'startedAt': int(time.time()), 'artifacts': {}, 'filesystem': {}}
    save = lambda: (output / 'verification.json').write_text(json.dumps(report, indent=2))
    save()
    paused = False
    try:
        paused = True  # Partial stop failures must also resume the selected services.
        run(compose + ['stop', '--timeout', '60', *WRITERS], timeout=120)
        assert all(not inspect(names[s])['State']['Running'] for s in WRITERS)
        dump = output / 'database.dump'
        with dump.open('wb') as stream:
            subprocess.run(['docker', 'exec', names['db'], 'sh', '-c',
                            'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'],
                           stdout=stream, stderr=subprocess.PIPE, check=True, timeout=90)
        def query(container, sql, restored=False):
            args = ['docker', 'exec', container, 'sh', '-c',
                    'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"', 'sh', sql]
            if restored:
                args = ['docker', 'exec', container, 'psql', '-U', 'postgres', '-d', 'restore', '-At', '-c', sql]
            return run(args, text=True).strip()
        tables = query(names['db'], "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
        def fingerprint_sql(table):
            return ("SELECT count(*)::text || ':' || md5(COALESCE(string_agg(row_to_json(r)::text, E'\\n' "
                    "ORDER BY row_to_json(r)::text),'')) FROM public.\"" + table.replace('"', '""') + '" AS r')
        counts = {table: query(names['db'], fingerprint_sql(table)) for table in tables}
        for service, source in mounts.items():
            files = tree_manifest(source)
            assert service == 'price-signer' or 'ledger.json' in files, 'Reward ledger is missing'
            # A signer with no reservations has a legitimately empty journal directory.
            archive = output / (service + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as tar:
                for name in files:
                    tar.add(source / name, arcname=name, recursive=False)
            assert tree_manifest(source) == files, 'Paused data changed during backup'
            report['filesystem'][service] = {'files': len(files), 'manifest': files}
        report['consistentStoppedSnapshot'] = True
        report['databaseFingerprints'] = counts
    finally:
        if paused:
            # Resume the exact existing configuration, with no build/pull or data changes.
            run(compose + ['up', '--detach', '--no-deps', '--no-build', '--pull', 'never',
                           '--wait', '--wait-timeout', '180', *WRITERS], timeout=240)
            report['writersResumed'] = True
            save()
    for name in ['database.dump', 'app.tar.gz', 'price-signer.tar.gz']:
        path = output / name
        report['artifacts'][name] = {'sha256': digest(path), 'bytes': path.stat().st_size}
    for service in mounts:
        target = output / ('restored-' + service)
        target.mkdir(mode=0o700)
        safe_extract(output / (service + '.tar.gz'), target)
        assert tree_manifest(target) == report['filesystem'][service]['manifest'], 'Restored file hashes differ'
    restore_name = 'richpad-restore-' + str(int(time.time()))
    created = False
    try:
        run(['docker', 'run', '--detach', '--name', restore_name, '--label', 'richpad.restore-test=' + output.name,
             '--network', 'none', '--read-only', '--memory', '512m', '--cpus', '1',
             '--tmpfs', '/var/lib/postgresql:rw,size=384m', '--tmpfs', '/var/run/postgresql:rw', '--tmpfs', '/tmp:rw',
             '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=restore', before['db']['Image']])
        created = True
        for attempt in range(30):
            ready = subprocess.run(['docker', 'exec', restore_name, 'pg_isready', '-U', 'postgres', '-d', 'restore'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if ready:
                break
            time.sleep(1)
        assert ready, 'Isolated restore database did not start'
        with (output / 'database.dump').open('rb') as stream:
            subprocess.run(['docker', 'exec', '-i', restore_name, 'pg_restore', '-U', 'postgres', '-d', 'restore',
                            '--no-owner', '--no-privileges', '--exit-on-error'], stdin=stream,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=90)
        restored = {t: query(restore_name, fingerprint_sql(t), True) for t in counts}
        assert restored == counts, 'Restored database row fingerprints differ'
        report.update(status='passed-isolated-restore', tables=len(counts), rows=sum(int(n.split(':')[0]) for n in counts.values()),
                      filesystemHashesMatched=True, databaseRowsMatched=True, noPublicRestorePorts=True,
                      finishedAt=int(time.time()))
        save()
        print(json.dumps({k: v for k, v in report.items() if k not in ['databaseFingerprints', 'filesystem']}))
    finally:
        if created:
            assert inspect(restore_name)['Config']['Labels']['richpad.restore-test'] == output.name
            run(['docker', 'rm', '--force', restore_name])
        lock.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        create_backup(args.compose.resolve(strict=True), args.output.resolve())
    except Exception as error:
        # Subprocess errors and JSON contents can contain runtime credentials.
        failure = {'status': 'failed', 'errorType': type(error).__name__,
                   'line': traceback.extract_tb(error.__traceback__)[-1].lineno,
                   'action': 'Inspect private backup state and service health before retrying.'}
        record = args.output / 'verification.json'
        if record.is_file():
            state = json.loads(record.read_text())
            state.update(failure)
            record.write_text(json.dumps(state, indent=2))
        print(json.dumps(failure))
        raise SystemExit(1)
