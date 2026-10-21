# RCC Helper — Diseño técnico

## Objetivo

Construir una aplicación local Next.js que genere datos RCC a partir de repositorios de Azure DevOps. La aplicación sustituye la selección manual de commits y merges y produce filas tabuladas con ruta, acción y último tag de despliegue donde cambió cada archivo.

La primera versión no usa base de datos, no genera Excel, no se publica y no modifica repositorios remotos ni copias de trabajo del usuario.

## Alcance

### Incluido

- Descubrimiento de todos los proyectos accesibles por el PAT.
- Consulta de repositorios de un proyecto.
- Consulta de tags de despliegue con prefijo configurable.
- RCC inicial desde un único tag.
- RCC incremental entre dos tags.
- Copia al portapapeles en formato TSV.
- Descarga del mismo contenido como TXT tabulado.
- Clones Git bare dedicados y actualización segura.
- Pruebas del motor con repositorios Git sintéticos.
- Instrucciones para configurar y ejecutar localmente.

### Excluido

- Búsqueda por fecha.
- Generación o carga de Excel.
- Base de datos.
- Publicación, pipelines y cambios en repositorios remotos.
- Autenticación individual para una aplicación compartida.
- Confirmación de que un despliegue terminó correctamente; los tags son referencias del proceso actual.

## Arquitectura

Una sola aplicación Next.js 16 con App Router:

```text
app/
  page.tsx
  api/
    projects/route.ts
    projects/[projectId]/repositories/route.ts
    repositories/[repositoryId]/tags/route.ts
    repositories/[repositoryId]/rcc/route.ts
components/
  rcc-form.tsx
  rcc-results.tsx
lib/server/
  config.ts
  process.ts
  azure-devops.ts
  git-store.ts
  rcc-engine.ts
  errors.ts
.data/repositories/
tests/
```

Los nombres pueden ajustarse durante la implementación si el comportamiento y las fronteras se conservan.

### Responsabilidades

- La página y los componentes cliente gestionan selecciones, estados de carga, presentación y exportación.
- Los Route Handlers validan entradas, autorización del catálogo y origen de solicitudes.
- `azure-devops.ts` consulta Azure DevOps mediante su API REST con `fetch` (PAT en cabecera, timeout de 10 segundos); no se usa Azure CLI.
- `git-store.ts` crea y actualiza clones bare y serializa las operaciones por repositorio.
- `rcc-engine.ts` contiene la lógica Git independiente de Azure DevOps.
- `process.ts` ejecuta procesos sin shell y captura salidas y errores de forma segura.

## Configuración

```dotenv
AZURE_DEVOPS_EXT_PAT=
RCC_TAG_PREFIX=develop_v
RCC_INTEGRATION_BRANCH=develop
```

La organización queda fija en servidor:

```text
https://dev.azure.com/alianzaapps
```

`RCC_TAG_PREFIX` tendrá el valor predeterminado `develop_v`. La rama de integración tendrá el valor predeterminado y operativo `develop`.

Se entregará `.env.example` sin credenciales. `.env*` y `.data/` se excluirán del control de versiones.

## Descubrimiento y autorización

`GET /api/projects` consulta la API REST (con `fetch`) para listar todos los proyectos accesibles. Si el PAT no permite descubrir proyectos, la operación falla con un mensaje claro; no existe catálogo manual de respaldo.

Los identificadores del frontend nunca se usan directamente como autorización:

1. Un `projectId` se resuelve contra la lista de proyectos accesibles.
2. Los repositorios se consultan dentro de ese proyecto.
3. Un `repositoryId` se resuelve contra repositorios devueltos por Azure DevOps.
4. La URL de clonación procede únicamente de ese resultado autorizado.

Todas las consultas REST incluyen explícitamente la organización `https://dev.azure.com/alianzaapps` y `api-version=7.1`; el PAT viaja únicamente en la cabecera `Authorization`.

La resolución de un repositorio dentro de un proyecto se memoiza por PAT, proyecto y repositorio con un TTL de 10 minutos (60 segundos para resultados negativos); la semántica de `NOT_FOUND` no cambia, solo se reutiliza la misma resolución que el PAT consiguió dentro del TTL.

## Almacenamiento Git

Cada repositorio autorizado usa un clon bare dedicado:

```text
.data/repositories/<repositoryId>.git
```

Antes de consultar tags o generar RCC, el servidor crea el clon si no existe o ejecuta una actualización con tags si ya existe. No modifica los repositorios de desarrollo del usuario. La actualización del espejo respeta un TTL de 2 minutos (un fetch exitoso evita nuevos fetch durante ese plazo, por lo que la obsolescencia máxima es el propio TTL) y los SHA de los tags se resuelven en un único `for-each-ref` por lotes, sin un `rev-parse` por tag.

Las operaciones de creación y actualización se protegen con un bloqueo en memoria por `repositoryId`. La primera versión asume un único proceso local de Next.js; no necesita bloqueo distribuido.

## Autenticación y seguridad

- El backend toma `AZURE_DEVOPS_EXT_PAT` del entorno y lo envía solo como cabecera `Authorization` Basic en cada llamada REST.
- Git recibe una cabecera de autenticación mediante variables de entorno `GIT_CONFIG_*` del proceso hijo.
- El PAT no se incluye en URLs, argumentos, respuestas, archivos ni logs.
- Los procesos se ejecutan con `spawn` o `execFile`, `shell: false` y arrays de argumentos.
- Los errores se limpian antes de registrarse o responderse.
- La aplicación se ejecuta en `127.0.0.1`.
- No se habilita CORS.
- `POST /rcc` valida que `Origin` corresponda al host local de la solicitud.
- Los parámetros y cuerpos se validan antes de consultar la API REST o ejecutar Git.

## API

### `GET /api/projects`

Devuelve proyectos accesibles:

```json
{
  "projects": [{ "id": "uuid", "name": "Proyecto" }]
}
```

### `GET /api/projects/:projectId/repositories`

Devuelve repositorios autorizados del proyecto:

```json
{
  "repositories": [{ "id": "uuid", "name": "Repositorio" }]
}
```

### `GET /api/repositories/:repositoryId/tags`

Actualiza la copia bare y devuelve tags cuyo nombre empieza por `RCC_TAG_PREFIX`, ordenados según el historial first-parent de la rama configurada. Si esa rama no existe, usa la rama predeterminada del repositorio y devuelve una advertencia.

Cada elemento incluye nombre, SHA y fecha del commit. Los tags fuera del historial válido no se ofrecen como extremos seleccionables. Si varios tags de despliegue apuntan al mismo commit, se usa la versión más alta y los demás se informan como alias.

### `POST /api/repositories/:repositoryId/rcc`

RCC inicial:

```json
{
  "mode": "initial",
  "toTag": "develop_v1.3.75"
}
```

RCC incremental:

```json
{
  "mode": "incremental",
  "fromTag": "develop_v1.3.72",
  "toTag": "develop_v1.3.75"
}
```

Respuesta:

```json
{
  "mode": "incremental",
  "from": {
    "tag": "develop_v1.3.72",
    "sha": "sha-completo"
  },
  "to": {
    "tag": "develop_v1.3.75",
    "sha": "sha-completo"
  },
  "rows": [
    {
      "path": "src/nuevo.ts",
      "previousPath": "src/anterior.ts",
      "action": "M",
      "lastChangedTag": "develop_v1.3.74"
    }
  ],
  "warnings": []
}
```

En modo inicial, `from` se omite.

## Motor RCC

### Resolución y secuencia de tags

- Los tags anotados se pelan hasta su commit y los tags ligeros se resuelven directamente.
- Los tags se filtran por prefijo.
- La secuencia válida es el historial first-parent de `develop`.
- El orden depende del historial Git, no del nombre ni de la fecha.
- Un rango incremental exige que ambos extremos estén en esa secuencia y que el tag inicial preceda al final.
- Los rangos invertidos, ramas divergentes y tags incompatibles se rechazan.
- Varios tags de despliegue sobre un mismo commit se tratan como alias; el de versión más alta es el canónico.
- Cada tag incluye la fecha de su commit para mostrarla en los selectores.

### RCC inicial

El motor ejecuta el equivalente bare de listar archivos versionados:

```bash
git ls-tree -r -z --name-only <toTag>
```

Cada archivo presente en el commit final produce:

```json
{
  "path": "ruta",
  "action": "A",
  "lastChangedTag": "<toTag>"
}
```

No se incluyen archivos no versionados porque un repositorio remoto bare no tiene carpeta de trabajo.

### RCC incremental

1. Construir la lista de despliegues consecutivos desde el tag inicial exclusivo hasta el final inclusivo.
2. Comparar cada par consecutivo con detección de renombrados de Git.
3. Procesar cambios cronológicamente y mantener la identidad de cada archivo a través de renombrados.
4. Registrar el último tag cuyo intervalo cambió cada ruta.
5. Calcular una diferencia neta entre los commits inicial y final.
6. Emitir únicamente las rutas presentes en esa diferencia neta.
7. Asignar el último tag registrado a cada fila neta.

Las filas se serializan en orden léxico por ruta (orden de `git ls-tree`); los tags reflejan el último cambio cronológico de cada ruta (los ordinales se usan solo para esa atribución).

La acción se determina por el estado neto:

- `A`: agregado entre los extremos, aunque después haya sido modificado.
- `M`: modificado o renombrado.
- `D`: eliminado.

Un renombrado usa la ruta final en `path`, la ruta original detectada en `previousPath` y acción `M`. Git detecta renombrados por similitud; no se implementará un detector alternativo.

Un archivo cuyo cambio se revierte completamente no aparece. Los cambios introducidos mediante merges aparecen al comparar instantáneas consecutivas, aunque el recorrido de despliegues use first-parent.

Las salidas Git que contienen rutas se procesan con delimitadores NUL para admitir espacios y caracteres especiales.

## Interfaz

La página presenta un flujo único:

1. Seleccionar proyecto.
2. Seleccionar repositorio.
3. Elegir modo “Primer RCC” o “RCC incremental”.
4. Seleccionar tag final y, para modo incremental, tag inicial.
5. Consultar cambios.
6. Revisar, copiar o descargar resultados.

Cambiar proyecto limpia repositorio, tags y resultados. Cambiar repositorio limpia tags y resultados. El botón de consulta permanece deshabilitado mientras falten datos o exista una operación en curso.

Se usarán únicamente los componentes shadcn necesarios: `Select`, `Button`, `Table` y `Alert`, además de indicadores de carga simples.

La tabla contiene:

```text
Orden de Instalación | Pasos | Acción | Directorio|Objeto|
```

Los estados visibles incluyen carga, rango sin cambios y errores comprensibles.

## Exportación

Copiar y descargar usan exactamente el mismo contenido TSV, con encabezados:

```text
Orden de Instalación	Pasos	Acción	Directorio|Objeto|
```

El archivo descargado se denomina:

```text
rcc-<repositorio>-<from>-<to>.txt
```

Para RCC inicial se omite `<from>`.

## Errores

La API normaliza al menos estas categorías:

- PAT ausente.
- PAT rechazado o expirado.
- Permiso insuficiente para listar proyectos o repositorios.
- Repositorio inaccesible.
- Git ausente.
- Fallo de conexión.
- Tag inexistente.
- Tags alias sobre un mismo commit.
- Rama de integración ausente, con fallback o error comprensible.
- Rango invertido.
- Historia incompatible.
- Rango sin cambios, representado como resultado válido con `rows: []`.

Las respuestas no contienen comandos completos, variables de entorno ni salida que pueda incluir secretos.

## Pruebas

Se usará `node:test` y repositorios Git temporales. Las pruebas no requieren Azure DevOps ni credenciales reales.

Casos mínimos:

- Archivo modificado en varios despliegues.
- Archivo agregado y posteriormente modificado.
- Eliminación.
- Renombrado seguido de modificación.
- Cambio revertido completamente.
- Cambios introducidos mediante merge.
- Tags anotados y ligeros.
- Tags alias y selección de la versión canónica.
- Fallback a la rama predeterminada.
- Rango invertido.
- Historia divergente.
- Rutas con espacios y caracteres especiales.
- RCC inicial con todos los archivos versionados como `A`.
- Rango sin cambios.

La capa de integración cubrirá además PAT ausente o rechazado y repositorio sin acceso mediante respuestas `fetch` simuladas. La prueba final contra Azure DevOps será manual y solo se ejecutará cuando el PAT esté configurado localmente. Los datos sintéticos nunca se presentarán como datos reales.

## Criterios de aceptación

- El usuario puede recorrer proyecto, repositorio y tags sin introducir IDs manualmente.
- El PAT nunca sale del servidor ni aparece en URLs, argumentos o logs.
- El RCC inicial lista todos los archivos versionados del tag como `A`.
- El RCC incremental cumple las reglas de secuencia, consolidación, acción y último tag.
- Los renombrados muestran la ruta anterior.
- Copiar y descargar producen TSV equivalente.
- Los errores definidos son comprensibles y no filtran información sensible.
- Las pruebas sintéticas cubren todos los escenarios enumerados.
- La documentación permite instalar requisitos, configurar el PAT y ejecutar la aplicación localmente.
