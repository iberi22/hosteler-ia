#!/usr/bin/env bash
# public-tree.sh — lista los archivos versionados que van al repo publico de Fize (AGPL-3.0).
#
# Regla: todo lo versionado MENOS private/** (facturacion/SaaS, infraestructura real y docs internos,
# que se copian al repo privado de infraestructura). Una ruta por linea, ordenada.
#
# Uso (desde cualquier parte del repo):
#   bash scripts/public-tree.sh            # lista
#   bash scripts/public-tree.sh | wc -l    # cuantos archivos
#   bash scripts/public-tree.sh --top      # solo el primer nivel del arbol publico
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

list() {
  git ls-files -z | tr '\0' '\n' | awk '!/^private\// && NF' | LC_ALL=C sort
}

if [[ "${1:-}" == "--top" ]]; then
  list | awk -F/ '{ print (NF > 1 ? $1 "/" : $1) }' | LC_ALL=C sort -u
else
  list
fi
