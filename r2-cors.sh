#!/usr/bin/env bash
set -euo pipefail

# Generate r2-cors.json from R2_CORS_ORIGINS in .env.
# The generated file is applied to the R2 bucket by `npm run r2:cors`.
# R2 needs this because browser uploads use cross-origin presigned PUT URLs.

env_path="${ENV_PATH:-.env}"
output_path="${OUTPUT_PATH:-r2-cors.json}"
origins_value=""

trim() {
	local value="$1"
	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	printf '%s' "$value"
}

unquote() {
	local value="$1"
	if [[ "$value" == \"*\" && "$value" == *\" ]]; then
		printf '%s' "${value:1:${#value}-2}"
		return
	fi

	if [[ "$value" == \'*\' && "$value" == *\' ]]; then
		printf '%s' "${value:1:${#value}-2}"
		return
	fi

	printf '%s' "${value%% #*}"
}

contains_origin() {
	local needle="$1"
	shift
	local origin
	for origin in "$@"; do
		if [[ "$origin" == "$needle" ]]; then
			return 0
		fi
	done

	return 1
}

plural_suffix() {
	if [[ "$1" == "1" ]]; then
		printf ''
		return
	fi

	printf 's'
}

if [[ ! -f "$env_path" ]]; then
	printf 'Missing %s. Set R2_CORS_ORIGINS before generating R2 CORS.\n' "$env_path" >&2
	exit 1
fi

# Read only the public upload origins from .env; secrets are ignored.
while IFS= read -r line || [[ -n "$line" ]]; do
	line="$(trim "$line")"
	if [[ -z "$line" || "$line" == \#* || "$line" != *=* ]]; then
		continue
	fi

	key="$(trim "${line%%=*}")"
	if [[ "$key" != "R2_CORS_ORIGINS" ]]; then
		continue
	fi

	origins_value="$(unquote "$(trim "${line#*=}")")"
	break
done < "$env_path"

if [[ -z "$origins_value" ]]; then
	printf 'Missing R2_CORS_ORIGINS in %s.\n' "$env_path" >&2
	exit 1
fi

IFS=',' read -r -a raw_origins <<< "$origins_value"
origins=()

for raw_origin in "${raw_origins[@]}"; do
	origin="$(trim "$raw_origin")"
	while [[ "$origin" == */ ]]; do
		origin="${origin%/}"
	done

	if [[ -z "$origin" ]]; then
		continue
	fi

	if [[ ! "$origin" =~ ^https?://[^[:space:]/,]+$ ]]; then
		printf 'Invalid R2 CORS origin: %s\n' "$origin" >&2
		exit 1
	fi

	if ! contains_origin "$origin" "${origins[@]}"; then
		origins+=("$origin")
	fi
done

if [[ ${#origins[@]} -eq 0 ]]; then
	printf 'R2_CORS_ORIGINS must contain at least one origin.\n' >&2
	exit 1
fi

# Keep the generated policy narrow: only browser PUT uploads with signed headers.
{
	printf '{\n'
	printf '\t"rules": [\n'
	printf '\t\t{\n'
	printf '\t\t\t"allowed": {\n'
	printf '\t\t\t\t"origins": [\n'
	for index in "${!origins[@]}"; do
		separator=','
		if [[ "$index" -eq $((${#origins[@]} - 1)) ]]; then
			separator=''
		fi
		printf '\t\t\t\t\t"%s"%s\n' "${origins[$index]}" "$separator"
	done
	printf '\t\t\t\t],\n'
	printf '\t\t\t\t"methods": [\n'
	printf '\t\t\t\t\t"PUT"\n'
	printf '\t\t\t\t],\n'
	printf '\t\t\t\t"headers": [\n'
	printf '\t\t\t\t\t"Content-Type",\n'
	printf '\t\t\t\t\t"Content-Length",\n'
	printf '\t\t\t\t\t"X-Amz-Meta-Clearmic-Upload-Id",\n'
	printf '\t\t\t\t\t"X-Amz-Meta-Clearmic-Expected-Size"\n'
	printf '\t\t\t\t]\n'
	printf '\t\t\t},\n'
	printf '\t\t\t"exposeHeaders": [\n'
	printf '\t\t\t\t"ETag"\n'
	printf '\t\t\t],\n'
	printf '\t\t\t"maxAgeSeconds": 3600\n'
	printf '\t\t}\n'
	printf '\t]\n'
	printf '}\n'
} > "$output_path"

printf 'Wrote %s with %s origin%s from R2_CORS_ORIGINS.\n' "$output_path" "${#origins[@]}" "$(plural_suffix "${#origins[@]}")"
