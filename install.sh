#!/bin/sh
set -eu

repository="yoshizawa56/muximo"
home_directory=${HOME:-}
if [ -z "$home_directory" ]; then
  printf '%s\n' "muximo installer: HOME is not set" >&2
  exit 1
fi

install_root=${MUXIMO_INSTALL_DIR:-"$home_directory/.local/libexec/muximo"}
command_directory=${MUXIMO_BIN_DIR:-"$home_directory/.local/bin"}
release_tag=${MUXIMO_RELEASE_TAG:-}

fail() {
  printf 'muximo installer: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

download() {
  url=$1
  output=$2

  if command_exists curl; then
    curl --fail --location --silent --show-error --retry 3 \
      --proto '=https' --tlsv1.2 --output "$output" "$url"
  elif command_exists wget; then
    wget --https-only --tries=3 --output-document="$output" "$url"
  else
    fail "curl or wget is required"
  fi
}

sha256_file() {
  file=$1

  if command_exists sha256sum; then
    sha256sum "$file" | awk '{ print $1 }'
  elif command_exists shasum; then
    shasum -a 256 "$file" | awk '{ print $1 }'
  elif command_exists openssl; then
    openssl dgst -sha256 "$file" | awk '{ print $NF }'
  else
    fail "sha256sum, shasum, or openssl is required to verify the download"
  fi
}

checksum_for() {
  filename=$1
  checksum_file=$2

  awk -v filename="$filename" '
    length($1) == 64 && $1 ~ /^[0-9A-Fa-f]+$/ {
      name = $2
      sub(/^\*/, "", name)
      sub(/^.*\//, "", name)
      if (name == filename) {
        print tolower($1)
        found = 1
        exit
      }
    }
    END {
      if (!found) exit 1
    }
  ' "$checksum_file"
}

case "$(uname -s)" in
  Darwin)
    release_os=macos
    ;;
  Linux)
    release_os=linux
    ;;
  *)
    fail "unsupported operating system: $(uname -s)"
    ;;
esac

case "$(uname -m)" in
  arm64|aarch64)
    release_arch=arm64
    ;;
  x86_64|amd64)
    release_arch=x64
    ;;
  *)
    fail "unsupported architecture: $(uname -m)"
    ;;
esac

asset="muximo-${release_os}-${release_arch}"
if [ -n "$release_tag" ]; then
  case "$release_tag" in
    *[!A-Za-z0-9._-]*)
      fail "MUXIMO_RELEASE_TAG contains unsupported characters: $release_tag"
      ;;
  esac
  base_url="https://github.com/${repository}/releases/download/${release_tag}"
  release_label=$release_tag
else
  base_url="https://github.com/${repository}/releases/latest/download"
  release_label="latest stable"
fi

mkdir -p "$install_root" "$command_directory"
install_root=$(cd "$install_root" && pwd)
command_directory=$(cd "$command_directory" && pwd)

temporary_binary=
temporary_checksum=
temporary_link="$command_directory/.muximo-link.$$"

cleanup() {
  [ -z "$temporary_binary" ] || rm -f "$temporary_binary"
  [ -z "$temporary_checksum" ] || rm -f "$temporary_checksum"
  rm -f "$temporary_link"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

temporary_binary=$(mktemp "$install_root/.muximo-download.XXXXXX") || fail "could not create a temporary install file"
temporary_checksum=$(mktemp "${TMPDIR:-/tmp}/muximo-checksum.XXXXXX") || fail "could not create a temporary checksum file"

binary_url="${base_url}/${asset}"
checksum_url="${base_url}/SHA256SUMS.txt"

printf 'Downloading %s release: %s\n' "$release_label" "$asset"
download "$binary_url" "$temporary_binary" || fail "could not download $binary_url"
download "$checksum_url" "$temporary_checksum" || fail "could not download $checksum_url"

expected_checksum=$(checksum_for "$asset" "$temporary_checksum") || fail "checksum for $asset was not found in SHA256SUMS.txt"
actual_checksum=$(sha256_file "$temporary_binary")
if [ "$actual_checksum" != "$expected_checksum" ]; then
  fail "checksum mismatch for $asset: expected $expected_checksum, got $actual_checksum"
fi

chmod 755 "$temporary_binary"
mv -f "$temporary_binary" "$install_root/muximo"

if [ -d "$command_directory/muximo" ] && [ ! -L "$command_directory/muximo" ]; then
  fail "cannot replace existing directory: $command_directory/muximo"
fi
ln -s "$install_root/muximo" "$temporary_link"
mv -f "$temporary_link" "$command_directory/muximo"

printf 'Installed production binary: %s\n' "$install_root/muximo"
printf 'Installed production command: %s\n' "$command_directory/muximo"

case ":${PATH:-}:" in
  *":$command_directory:"*)
    ;;
  *)
    printf 'Add %s to PATH to run muximo directly.\n' "$command_directory" >&2
    ;;
esac

if ! command_exists tmux; then
  printf '%s\n' "Warning: tmux was not found on PATH. muximo requires tmux at runtime." >&2
fi
