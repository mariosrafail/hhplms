"""Extract only regular tracked Git archive members into a new owned stage."""
import pathlib
import sys
import tarfile

archive, destination = map(pathlib.Path, sys.argv[1:])
root = destination.resolve(strict=True)
total = 0
with tarfile.open(archive, 'r:') as source:
    members = source.getmembers()
    if len(members) > 60000:
        raise ValueError('offline_code_entry_limit')
    for member in members:
        if not (member.isfile() or member.isdir()):
            raise ValueError('offline_code_link_forbidden')
        target = root.joinpath(member.name).resolve()
        if not target.is_relative_to(root):
            raise ValueError('offline_code_path_unsafe')
        total += member.size
        if total > 8 * 1024**3:
            raise ValueError('offline_code_size_limit')
    source.extractall(root, members=members, filter='data')
