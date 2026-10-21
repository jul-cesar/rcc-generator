# BUG-2026-10-20T184911: Rama de integración ausente

## Razón de existencia

Evitar que un repositorio sin la rama configurada exponga un error crudo de Git.

## Problema

- **Actual:** Consultar tags ejecuta el historial de `develop` aunque la rama no exista.
- **Esperado:** Usar la rama predeterminada o devolver un mensaje comprensible.
- **Reproducción:** Abrir un repositorio cuya única rama es `main` con `RCC_INTEGRATION_BRANCH=develop`.
- **Impacto de seguridad:** NONE. No se identificó una ruta de explotación.

## Análisis de causa raíz

### 1. Reproducir

Un repositorio local con `main` y sin `develop` reproduce `fatal: ambiguous argument 'refs/heads/develop'`.

### 2. Aislar

El catálogo construía la referencia configurada sin comprobar las ramas disponibles ni `HEAD`.

### 3. Hipótesis

Resolver primero la rama configurada y usar `HEAD` como fallback evita invocar Git con una referencia inexistente.

### 4. Verificar

Las pruebas fallaron con el error crudo antes del cambio y pasan al resolver la rama predeterminada. También cubren repositorios sin tags y sin rama predeterminada válida.

- **Tipo:** validación faltante en el límite Git.
- **Riesgo del arreglo:** Bajo.

## Plan TDD

1. **RED:** Exigir fallback a la rama predeterminada cuando falta la configurada.
   **GREEN:** Resolver las ramas antes de recorrer el historial.
   **verify:** `npx tsx --test tests/rcc-tags.test.ts`

2. **RED:** Exigir advertencias explícitas cuando no existen tags compatibles.
   **GREEN:** Añadir advertencias al catálogo y combinarlas en la API.
   **verify:** `npx tsx --test tests/rcc-tags.test.ts`

3. **RED:** Exigir un error de dominio cuando no existe un fallback válido.
   **GREEN:** Devolver `NOT_FOUND` con las ramas disponibles.
   **verify:** `npx tsx --test tests/rcc-tags.test.ts`

## Criterios de aceptación

- [x] La rama configurada sigue teniendo prioridad.
- [x] La rama predeterminada se usa como fallback con advertencia.
- [x] La ausencia de tags produce una advertencia explícita.
- [x] La ausencia total de una rama válida produce un error comprensible.

## Resolución

El catálogo resuelve la rama antes de recorrer el historial, conserva las advertencias de fallback y evita exponer mensajes crudos de Git.
