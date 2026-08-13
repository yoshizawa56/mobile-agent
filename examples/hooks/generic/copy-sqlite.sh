#!/bin/sh
set -eu

source_file=
target_file=
force=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source)
      [ "$#" -ge 2 ] || { printf '%s\n' '--source requires a value' >&2; exit 2; }
      source_file=$2
      shift 2
      ;;
    --target)
      [ "$#" -ge 2 ] || { printf '%s\n' '--target requires a value' >&2; exit 2; }
      target_file=$2
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    -h|--help)
      printf '%s\n' 'usage: copy-sqlite.sh --source FILE --target FILE [--force]'
      exit 0
      ;;
    *)
      printf 'copy-sqlite: unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$source_file" ] || [ -z "$target_file" ]; then
  printf '%s\n' 'usage: copy-sqlite.sh --source FILE --target FILE [--force]' >&2
  exit 2
fi

if [ "$source_file" = "$target_file" ]; then
  printf 'SQLite source and target are the same; keeping %s\n' "$target_file"
  exit 0
fi
if [ ! -f "$source_file" ]; then
  printf 'copy-sqlite: source does not exist: %s\n' "$source_file" >&2
  exit 1
fi
if [ -e "$target_file" ] && [ "$force" -ne 1 ]; then
  printf 'SQLite target already exists; keeping %s\n' "$target_file"
  exit 0
fi

# A non-empty WAL or rollback journal means that copying only the main file
# could omit committed data. Stop the writer and checkpoint it before using
# this simple single-file helper.
for journal_file in "$source_file-wal" "$source_file-journal"; do
  if [ -s "$journal_file" ]; then
    printf 'copy-sqlite: source has an active journal (%s); stop the database before copying\n' "$journal_file" >&2
    exit 1
  fi
done

mkdir -p "$(dirname -- "$target_file")"
if [ "$force" -eq 1 ]; then
  cp -fp "$source_file" "$target_file"
else
  cp -p "$source_file" "$target_file"
fi
printf 'copied SQLite file to %s\n' "$target_file"
