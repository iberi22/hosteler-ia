#!/usr/bin/env bash
# check-public-tree.sh — gate del arbol publico: nada fuera de private/ puede traer infraestructura real.
#
# Revisa los archivos del arbol publico (versionados + nuevos sin ignorar, menos private/**):
#   1. ids reales de Cloudflare (cuenta, D1, KV). El script NO contiene los ids: compara el SHA-256 de cada
#      token con forma de id (32 hex o UUID) contra una lista de hashes. Asi el gate puede vivir en el repo
#      publico sin publicar lo que protege. En el repo privado suma ademas los ids que encuentre en
#      private/infra/wrangler/* (config real), para que un id nuevo quede cubierto sin tocar este archivo.
#   2. rutas que en el historial viejo tuvieron secretos (.gemini/, .kiro/, .rovodev/, firebase-config.ts,
#      DEPLOYMENT.md, PLANNING.md, docs/legacy/PLANNING.md) y config real de wrangler versionada.
#   3. gitleaks sobre una copia del arbol publico (`gitleaks dir`). Sin gitleaks instalado falla,
#      salvo FIZE_SKIP_GITLEAKS=1 (solo para depurar en local; CI lo instala). LEAKS_SCANNER=<ruta al
#      binario de gitleaks> si no esta en el PATH.
#
# Uso: bash scripts/check-public-tree.sh   -> exit 0 limpio, 1 con hallazgos.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAIL=0
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL + 1)); }

FILES="$(mktemp)"
trap 'rm -f "$FILES"; [[ -n "${COPY:-}" ]] && rm -rf "$COPY"' EXIT
git ls-files -z --cached --others --exclude-standard \
  | tr '\0' '\n' | awk '!/^private\// && NF' | LC_ALL=C sort -u \
  | while IFS= read -r f; do [[ -f "$f" ]] && printf '%s\n' "$f"; done > "$FILES"
echo "=== Fize public tree check ($(wc -l < "$FILES") archivos fuera de private/) ==="

# --- 1. ids reales de Cloudflare -------------------------------------------------------------------
echo "[1/3] ids reales de Cloudflare"
python3 - "$FILES" <<'PY' || FAIL=$((FAIL + 1))
import hashlib, json, os, re, sys

# SHA-256 de los ids reales conocidos (cuenta, D1 actual, D1 anterior, KV SESSION, KV SWAL_KV).
KNOWN = {
    "3eeeb6ee59e2fab1c520c88caf05f7f2b6b0cc8f2995c670da5c7a01c4738ee4",
    "f7258e04f37a99113d8a171ec1a38b2f0669231a4605280f375db6402b11b407",
    "3d410d1b64a3a88802719980f0f2670e24bbbe0292ec99a461ddb7f88dc3698e",
    "261d414ff1b0a56478909554b219fd435df0215650879fc887abfab22fbd47ec",
    "64f78f97617eb6a1efaa77b713327c13b90086bc6fa7947c2774eed61dce0a1d",
}
ID_RE = re.compile(r"(?<![0-9a-fA-F-])(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?![0-9a-fA-F-])")

def h(s):
    return hashlib.sha256(s.lower().encode()).hexdigest()

known = set(KNOWN)
# Repo privado: los ids de la config real tambien cuentan.
infra = os.path.join("private", "infra", "wrangler")
if os.path.isdir(infra):
    for name in os.listdir(infra):
        try:
            text = open(os.path.join(infra, name), encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for m in re.finditer(r'(?:account_id|database_id|"id"|^id)\s*[:=]\s*"([0-9a-fA-F-]{32,36})"', text, re.M):
            known.add(h(m.group(1)))

hits = 0
for path in open(sys.argv[1], encoding="utf-8").read().splitlines():
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        continue
    if b"\0" in data[:8192]:
        continue  # binario
    for n, line in enumerate(data.decode("utf-8", "ignore").splitlines(), 1):
        for m in ID_RE.finditer(line):
            if h(m.group(0)) in known:
                hits += 1
                print(f"  [FAIL] id real de Cloudflare en {path}:{n} (sha256 {h(m.group(0))[:12]}...)")
print(f"  [{'FAIL' if hits else 'OK'}] {hits} id(s) real(es) fuera de private/")
sys.exit(1 if hits else 0)
PY

# --- 2. rutas prohibidas -----------------------------------------------------------------------------
echo "[2/3] rutas prohibidas en el arbol publico"
before=$FAIL
while IFS= read -r f; do
  case "$f" in
    .gemini/*|.kiro/*|.rovodev/*|*/.gemini/*|*/.kiro/*|*/.rovodev/*) fail "ruta con secretos en el historial: $f" ;;
    src/lib/firebase-config.ts|*/src/lib/firebase-config.ts) fail "ruta con secretos en el historial: $f" ;;
    DEPLOYMENT.md|PLANNING.md|docs/legacy/PLANNING.md) fail "ruta con secretos en el historial: $f" ;;
    src-astro/wrangler.toml|src-astro/wrangler.jsonc|src-astro/wrangler.json) fail "config real de wrangler versionada: $f (usar wrangler.example.jsonc)" ;;
    */.wrangler/*|.wrangler/*) fail "estado local de wrangler versionado: $f" ;;
    .env|.env.*|*/.env|*/.env.*) [[ "$f" == *.example ]] || fail "archivo .env versionado: $f" ;;
  esac
done < "$FILES"
[[ $FAIL -eq $before ]] && echo "  [OK] ninguna ruta prohibida"

# --- 3. gitleaks ---------------------------------------------------------------------------------------
echo "[3/3] gitleaks sobre el arbol publico"
LEAKS="${LEAKS_SCANNER:-gitleaks}"
if command -v "$LEAKS" >/dev/null 2>&1; then
  COPY="$(mktemp -d)"
  tar -cf - -T "$FILES" | tar -xf - -C "$COPY"
  if "$LEAKS" detect --no-git --source "$COPY" --no-banner --no-color --redact -v >/tmp/fize-gitleaks.$$ 2>&1; then
    echo "  [OK] gitleaks: sin hallazgos"
  else
    sed "s#$COPY/##g" /tmp/fize-gitleaks.$$ | tail -40
    fail "gitleaks encontro posibles secretos"
  fi
  rm -f /tmp/fize-gitleaks.$$
elif [[ "${FIZE_SKIP_GITLEAKS:-}" == "1" ]]; then
  echo "  [SKIP] gitleaks no instalado y FIZE_SKIP_GITLEAKS=1"
else
  fail "gitleaks no esta instalado (https://github.com/gitleaks/gitleaks/releases)"
fi

echo "==============================================="
if [[ $FAIL -eq 0 ]]; then
  echo "[PASS] arbol publico limpio"
  exit 0
fi
echo "[FAIL] $FAIL hallazgo(s) en el arbol publico"
exit 1
