#!/usr/bin/env bash
#
# scripts/resource-pulse-cargo-target-dir.sh
# ==========================================
#
# Prints this checkout's own cargo build directory for the Resource Pulse
# sampler crate (resource-pulse-sampler/), and a newline:
#
#   ${XDG_CACHE_HOME:-$HOME/.cache}/resource-pulse/cargo-target-<id>
#
# where <id> is the first 12 hex digits of the SHA-256 of the crate
# directory's real path, as a person can compute it in a checkout:
#
#   printf '%s' "$(cd resource-pulse-sampler && pwd -P)" | sha256sum | cut -c1-12
#
# Why one directory per checkout, and not one shared by every checkout: cargo
# judges a path package fresh by its files' times wherever the package lives.
# In a directory two checkouts share, `cargo test` in one runs the other's test
# binaries when its own files are older than the other's last build there, and
# a release build hands over the other's program. Each directory is only a
# cache: any of them is safe to remove.
#
# Its callers: the sampler's state tables (scripts/resource-pulse-sampler-table-lib.sh,
# which they source, where a caller's CARGO_TARGET_DIR still wins) and the nested harness's
# real-service mode (scripts/resource-pulse-nested.sh start, which builds the
# release program here). The build step
# (scripts/resource-pulse-sampler-build.sh) keeps a directory of its own.
#
# Usage: scripts/resource-pulse-cargo-target-dir.sh   (no argument)
#
# Exit: 0 the path printed; 2 it cannot be worked out (an argument given,
#       neither XDG_CACHE_HOME nor HOME set, a cache directory that is not an
#       absolute path, no crate directory, or no readlink or sha256sum): one line on
#       stderr, nothing on stdout.

set -uo pipefail

readonly EXIT_CANNOT_WORK_OUT=2
readonly CHECKOUT_ID_HEX_DIGITS=12
readonly CRATE_DIRECTORY_NAME='resource-pulse-sampler'
readonly CACHE_SUBDIRECTORY='resource-pulse'
readonly TARGET_DIRECTORY_PREFIX='cargo-target-'
readonly CHECKOUT_ID_PATTERN="^[0-9a-f]{$CHECKOUT_ID_HEX_DIGITS}"
readonly PROGRAM_NAME='resource-pulse-cargo-target-dir'

#######################################
# Print one line on stderr and exit EXIT_CANNOT_WORK_OUT.
# Arguments:
#   $@ - the reason
#######################################
cannot_work_out() {
    printf '%s: cannot work out the cargo build directory: %s\n' "$PROGRAM_NAME" "$*" >&2
    exit "$EXIT_CANNOT_WORK_OUT"
}

#######################################
# Print the cache directory the build directory goes under: XDG_CACHE_HOME,
# else $HOME/.cache. Exits EXIT_CANNOT_WORK_OUT when neither is set, or when
# the one chosen is not absolute (cargo would read a relative one against the
# caller's working directory).
#######################################
cache_root_directory() {
    local cache_root
    if [[ -n "${XDG_CACHE_HOME:-}" ]]; then
        cache_root="$XDG_CACHE_HOME"
    elif [[ -n "${HOME:-}" ]]; then
        cache_root="$HOME/.cache"
    else
        cannot_work_out "neither XDG_CACHE_HOME nor HOME is set"
    fi
    [[ "$cache_root" == /* ]] || cannot_work_out "the cache directory is not an absolute path: $cache_root"
    printf '%s' "$cache_root"
}

#######################################
# Print the crate directory's real path (symbolic links resolved, as pwd -P
# gives it). Exits EXIT_CANNOT_WORK_OUT when it is not there.
#######################################
crate_real_path() {
    local script_path script_directory crate_path
    command -v readlink >/dev/null || cannot_work_out "readlink is required"
    # Resolved, so a link to this script elsewhere still finds the crate beside the checkout's scripts/.
    script_path="$(readlink -f -- "${BASH_SOURCE[0]}" 2>/dev/null)" \
        || cannot_work_out "cannot resolve this script's path: ${BASH_SOURCE[0]}"
    [[ "$script_path" == /* ]] || cannot_work_out "this script's path did not resolve to an absolute one: $script_path"
    script_directory="${script_path%/*}"
    crate_path="$(cd -- "$script_directory/../$CRATE_DIRECTORY_NAME" 2>/dev/null && pwd -P)" \
        || cannot_work_out "no crate directory at $script_directory/../$CRATE_DIRECTORY_NAME"
    printf '%s' "$crate_path"
}

#######################################
# Print the checkout's id: the first CHECKOUT_ID_HEX_DIGITS hex digits of the
# SHA-256 of a path. Exits EXIT_CANNOT_WORK_OUT when sha256sum is missing or
# prints no digest.
# Arguments:
#   $1 - the crate directory's real path
#######################################
checkout_id_of() {
    local digest_line
    command -v sha256sum >/dev/null || cannot_work_out "sha256sum is required"
    digest_line="$(printf '%s' "$1" | sha256sum)" || cannot_work_out "sha256sum failed on $1"
    [[ "$digest_line" =~ $CHECKOUT_ID_PATTERN ]] || cannot_work_out "sha256sum printed no digest for $1"
    printf '%s' "${BASH_REMATCH[0]}"
}

main() {
    local cache_root crate_path checkout_id
    (( $# == 0 )) || cannot_work_out "it takes no argument, got: $*"
    cache_root="$(cache_root_directory)" || exit "$EXIT_CANNOT_WORK_OUT"
    crate_path="$(crate_real_path)" || exit "$EXIT_CANNOT_WORK_OUT"
    checkout_id="$(checkout_id_of "$crate_path")" || exit "$EXIT_CANNOT_WORK_OUT"
    printf '%s/%s/%s%s\n' "$cache_root" "$CACHE_SUBDIRECTORY" "$TARGET_DIRECTORY_PREFIX" "$checkout_id"
}

main "$@"
