# BUG-2026-10-20T161642: Los tags alias bloquean el selector

## Razón de existencia

Permitir seleccionar despliegues cuando varios tags de versión apuntan al mismo commit, sin perder trazabilidad.

## Problema

- **Actual:** Todos los tags de un commit compartido se eliminan del catálogo. Si todos los commits etiquetados tienen alias, el selector queda vacío.
- **Esperado:** El tag de versión más alta representa al commit; los demás se informan como alias.
- **Reproducción:** Crear `develop_v1.0.17`, `develop_v1.0.18` y `develop_v1.0.19` sobre el mismo commit y cargar el catálogo.
- **Impacto de seguridad:** NONE. No se identificó una ruta de explotación.

## Análisis de causa raíz

### 1. Reproducir

Las pruebas del catálogo confirman que un commit con más de un tag se registra como ambiguo y no aporta ninguna opción seleccionable.

### 2. Aislar

El agrupamiento por commit descarta el grupo completo cuando contiene más de un tag. La interfaz solo puede mostrar la lista resultante y queda vacía cuando no existen grupos de un solo tag.

### 3. Hipótesis

Conservar el tag de versión más alta de cada grupo elimina el bloqueo y mantiene una secuencia única por commit.

### 4. Verificar

Una prueba con `v1.0.9` y `v1.0.10` sobre el mismo commit falla antes del cambio y confirma que `v1.0.10` debe ser el tag canónico.

- **Tipo:** defecto de modelado de alias.
- **Riesgo del arreglo:** Bajo.

## Plan TDD

1. **RED:** Exigir que el catálogo conserve el tag de versión más alta y exponga la fecha del commit.
   **GREEN:** Ordenar numéricamente los tags por commit, conservar el último y leer la fecha en la misma consulta Git.
   **verify:** `npx tsx --test tests/rcc-tags.test.ts`

2. **RED:** Exigir que RCC inicial e incremental acepten el tag canónico.
   **GREEN:** Retirar los rechazos de ambigüedad ahora resueltos por canonicalización.
   **verify:** `npx tsx --test tests/rcc-initial.test.ts tests/rcc-incremental.test.ts`

3. **RED:** Exigir una etiqueta visible con nombre y fecha.
   **GREEN:** Formatear cada opción como `tag · DD/MM/AAAA`.
   **verify:** `npx tsx --test tests/rcc-form.test.ts`

## Criterios de aceptación

- [x] Cada commit aporta como máximo un tag seleccionable.
- [x] Se selecciona la versión numéricamente más alta.
- [x] Los alias producen una advertencia informativa.
- [x] Cada opción muestra la fecha del commit.
- [x] Las pruebas existentes siguen pasando.

## Resolución

El catálogo conserva el tag canónico, mantiene los alias para advertencias y añade `commitDate`. RCC usa la secuencia canonicalizada y la interfaz muestra la fecha sin cambiar el valor enviado al servidor.
