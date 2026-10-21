# BUG-2026-10-20T153921: El formulario permite un rango con el mismo tag

## Razón de existencia

Evitar que la interfaz envíe un rango incremental que el contrato del motor define como vacío.

## Problema

- **Actual:** La interfaz permite seleccionar el mismo tag como entrega anterior y final. La consulta llega al servidor y termina con “El rango está invertido o no avanza en el historial”.
- **Esperado:** La interfaz debe impedir esa combinación y explicar que, para obtener una sola entrega, se selecciona su tag anterior como inicio y la entrega deseada como final.
- **Reproducción:** Seleccionar modo incremental, elegir el mismo tag en ambos campos y consultar.
- **Impacto de seguridad:** NONE. No se identificó una ruta de explotación.

## Análisis de causa raíz

### 1. Reproducir

Una reproducción aislada con un repositorio de un tag devuelve de forma consistente el conflicto documentado al usar ese tag en ambos extremos.

### 2. Aislar

El motor exige que el índice del tag inicial sea estrictamente menor que el índice del tag final. La interfaz, en cambio, habilita la consulta cuando ambos campos solo están completos; no valida orden ni igualdad.

### 3. Hipótesis

La causa es una validación incompleta en el límite de la interfaz. Se falsaría si el botón permaneciera deshabilitado o si el selector final excluyera tags que no avanzan respecto al inicial.

### 4. Verificar

La inspección del flujo y la reproducción confirman una sola causa: el formulario admite un estado que el contrato del motor rechaza. El motor no debe reinterpretar silenciosamente un rango vacío.

- **Tipo:** defecto de UX / validación faltante.
- **Riesgo del arreglo:** Bajo.

## Plan TDD

1. **RED:** Comprobar que un rango incremental con tags iguales no se puede enviar desde el formulario.
   **GREEN:** Deshabilitar la consulta cuando los tags sean iguales y limitar el tag final a entregas posteriores al inicial.
   **verify:** `npm test && npm run typecheck && npm run lint`

2. **RED:** Comprobar que una entrega individual se obtiene con el tag inmediatamente anterior como inicio y el tag deseado como final.
   **GREEN:** Mantener el contrato actual del motor y añadir ayuda breve junto a los selectores si la restricción no resulta evidente.
   **verify:** `npm test -- --test-name-pattern="includes changes introduced by a merge"`

**REFACTOR:** Ninguno.

## Criterios de aceptación

- [x] No se puede enviar el mismo tag en ambos extremos.
- [x] Un rango inválido selecciona automáticamente el tag anterior.
- [x] El primer tag cambia al modo Primer RCC.
- [x] Un rango entre tags consecutivos devuelve los cambios de esa entrega.
- [x] Las pruebas nuevas y existentes pasan.

## Resolución

La selección de la entrega final conserva un rango manual válido. Si el rango está vacío, igual o invertido, usa automáticamente el tag canónico anterior; para el primer tag cambia a Primer RCC.
