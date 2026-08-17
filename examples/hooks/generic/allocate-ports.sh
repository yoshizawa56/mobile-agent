#!/bin/sh
set -eu

DEFAULT_STRIDE=2
DEFAULT_SLOT_COUNT=20000

usage() {
  printf '%s\n' 'usage: allocate-ports.sh allocate --key KEY --env-path FILE --port NAME=BASE [options]'
}

die() {
  printf 'allocate-ports: %s\n' "$*" >&2
  exit 1
}

validate_name() {
  case "$1" in
    ""|[0-9]*|*[!A-Za-z0-9_]*)
      die "invalid environment variable name: $1"
      ;;
  esac
}

validate_positive_integer() {
  case "$2" in
    ""|*[!0-9]*)
      die "$1 must be a positive integer"
      ;;
  esac
  [ "$2" -ge 1 ] || die "$1 must be a positive integer"
}

validate_port() {
  validate_positive_integer "$1" "$2"
  [ "$2" -le 65535 ] || die "$1 must be between 1 and 65535"
}

parse_assignment() {
  assignment=$1
  case "$assignment" in
    *=*) ;;
    *) die "expected NAME=VALUE, got: $assignment" ;;
  esac

  assignment_name=${assignment%%=*}
  assignment_value=${assignment#*=}
  validate_name "$assignment_name"
}

command=${1:-}
if [ "$command" = "--help" ] || [ "$command" = "-h" ]; then
  usage
  exit 0
fi
if [ "$command" != "allocate" ]; then
  usage >&2
  exit 2
fi
shift

key=
env_path=
stride=$DEFAULT_STRIDE
slot_count=$DEFAULT_SLOT_COUNT
temporary_directory=${TMPDIR:-/tmp}/muximo-allocate-ports.$$

umask 077
mkdir "$temporary_directory" 2>/dev/null || die "could not create temporary directory: $temporary_directory"
cleanup() {
  rm -rf "$temporary_directory"
}
trap cleanup EXIT HUP INT TERM

ports_file=$temporary_directory/ports
sets_file=$temporary_directory/sets
port_values_file=$temporary_directory/port-values
values_file=$temporary_directory/values
preserved_file=$temporary_directory/preserved
status_file=$temporary_directory/status
lanes_file=$temporary_directory/lanes
: > "$ports_file"
: > "$sets_file"
: > "$port_values_file"
: > "$values_file"
: > "$preserved_file"
: > "$status_file"
: > "$lanes_file"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --key)
      [ "$#" -ge 2 ] || die '--key requires a value'
      key=$2
      shift 2
      ;;
    --env-path)
      [ "$#" -ge 2 ] || die '--env-path requires a value'
      env_path=$2
      shift 2
      ;;
    --stride)
      [ "$#" -ge 2 ] || die '--stride requires a value'
      stride=$2
      shift 2
      ;;
    --slot-count)
      [ "$#" -ge 2 ] || die '--slot-count requires a value'
      slot_count=$2
      shift 2
      ;;
    --port)
      [ "$#" -ge 2 ] || die '--port requires a value'
      parse_assignment "$2"
      validate_port "$assignment_name" "$assignment_value"
      printf '%s\t%s\n' "$assignment_name" "$assignment_value" >> "$ports_file"
      shift 2
      ;;
    --set)
      [ "$#" -ge 2 ] || die '--set requires a value'
      parse_assignment "$2"
      printf '%s\t%s\n' "$assignment_name" "$assignment_value" >> "$sets_file"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[ -n "$key" ] || die '--key is required'
[ -n "$env_path" ] || die '--env-path is required'
[ -s "$ports_file" ] || die 'allocate requires at least one --port NAME=BASE option'
validate_positive_integer stride "$stride"
validate_positive_integer slot-count "$slot_count"

if ! awk -F '\t' 'seen[$1]++ { duplicate = 1 } END { exit(duplicate ? 1 : 0) }' "$ports_file"; then
  die 'the same port variable was specified more than once'
fi
if ! awk -F '\t' 'seen[$1]++ { duplicate = 1 } END { exit(duplicate ? 1 : 0) }' "$sets_file"; then
  die 'the same --set variable was specified more than once'
fi
if ! awk -F '\t' '
  NR == FNR { port_names[$1] = 1; next }
  ($1 in port_names) { conflict = 1 }
  END { exit(conflict ? 1 : 0) }
' "$ports_file" "$sets_file"; then
  die '--set cannot override a --port variable'
fi

while IFS="$(printf '\t')" read -r port_name port_base; do
  maximum=$((port_base + (slot_count - 1) * stride))
  [ "$maximum" -le 65535 ] || die "$port_name exceeds port 65535 with the selected slot-count and stride"
  lane=$((port_base % stride))
  if grep -Fqx "$lane" "$lanes_file"; then
    die "port bases must use different lanes modulo stride; adjust --stride or --port for $port_name"
  fi
  printf '%s\n' "$lane" >> "$lanes_file"
done < "$ports_file"

command -v cksum >/dev/null 2>&1 || die 'cksum is required for deterministic port allocation'
checksum=$(printf '%s' "$key" | cksum | awk '{ print $1 }')
case "$checksum" in
  ""|*[!0-9]*) die 'could not calculate a deterministic checksum' ;;
esac
slot=$((checksum % slot_count))

existing_env_value() {
  variable=$1
  [ -f "$env_path" ] || return 1
  awk -v wanted="$variable" '
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]*/, "", line)
      name = line
      sub(/[[:space:]]*=.*$/, "", name)
      gsub(/[[:space:]]/, "", name)
      if (name == wanted) {
        sub(/^[^=]*=/, "", line)
        sub(/^[[:space:]]+/, "", line)
        sub(/[[:space:]]+$/, "", line)
        print line
        found = 1
        exit
      }
    }
    END { exit(found ? 0 : 1) }
  ' "$env_path"
}

while IFS="$(printf '\t')" read -r port_name port_base; do
  derived_port=$((port_base + slot * stride))
  if existing_port=$(existing_env_value "$port_name"); then
    case "$existing_port" in
      \"*\")
        existing_port=${existing_port#\"}
        existing_port=${existing_port%\"}
        ;;
    esac
    validate_port "$port_name" "$existing_port"
    port_value=$existing_port
    port_status=preserved
    printf '%s\n' "$port_name" >> "$preserved_file"
  else
    port_value=$derived_port
    port_status=derived
  fi
  printf '%s\t%s\n' "$port_name" "$port_value" >> "$port_values_file"
  printf '%s\t%s\n' "$port_name" "$port_value" >> "$values_file"
  printf '%s\t%s\t%s\n' "$port_status" "$port_name" "$port_value" >> "$status_file"
done < "$ports_file"

if ! awk -F '\t' 'seen[$2]++ { overlap = 1 } END { exit(overlap ? 1 : 0) }' "$port_values_file"; then
  die "port assignments overlap in $env_path; choose different port values"
fi

cat "$sets_file" >> "$values_file"
if ! awk -F '\t' 'seen[$1]++ { duplicate = 1 } END { exit(duplicate ? 1 : 0) }' "$values_file"; then
  die 'a variable was assigned more than once'
fi

mkdir -p "$(dirname -- "$env_path")"
temporary_env_path=$env_path.tmp.$$
if [ -f "$env_path" ]; then
  awk -F '\t' -v values_path="$values_file" -v preserved_path="$preserved_file" '
    BEGIN {
      while ((getline line < values_path) > 0) {
        separator = index(line, "\t")
        name = substr(line, 1, separator - 1)
        values[name] = substr(line, separator + 1)
        order[++count] = name
      }
      close(values_path)
      while ((getline name < preserved_path) > 0) preserved[name] = 1
      close(preserved_path)
    }
    {
      line = $0
      name = line
      sub(/^[[:space:]]*export[[:space:]]*/, "", name)
      sub(/[[:space:]]*=.*$/, "", name)
      gsub(/[[:space:]]/, "", name)
      if (name in values) {
        if (seen[name]++) next
        if (name in preserved) print $0
        else print name "=" values[name]
      } else {
        print $0
      }
    }
    END {
      for (entry_index = 1; entry_index <= count; entry_index++) {
        name = order[entry_index]
        if (!(name in seen)) print name "=" values[name]
      }
    }
  ' "$env_path" > "$temporary_env_path"
else
  awk -F '\t' '{ print $1 "=" $2 }' "$values_file" > "$temporary_env_path"
fi
mv "$temporary_env_path" "$env_path"

while IFS="$(printf '\t')" read -r port_status port_name port_value; do
  printf '%s %s=%s (slot %s)\n' "$port_status" "$port_name" "$port_value" "$slot"
done < "$status_file"
