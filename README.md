# RCC Helper

Aplicación local para generar datos RCC desde repositorios de Azure DevOps. Consulta proyectos, repositorios y tags de despliegue, compara el historial Git y permite copiar el resultado como TSV o descargarlo como TXT.

## Requisitos

- Node.js 20.9 o posterior.
- Git disponible en `PATH`.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli).
- Extensión `azure-devops` de Azure CLI.
- Un PAT de Azure DevOps con acceso de lectura a proyectos y código de la organización `alianzaapps`.

Instala la extensión si aún no está disponible:

```bash
az extension add --name azure-devops
```

No es necesario ejecutar `az devops login`. La aplicación entrega el PAT a Azure CLI mediante `AZURE_DEVOPS_EXT_PAT`.

## Configuración

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.example` como `.env.local`.
3. Abre `.env.local` y asigna tu PAT a `AZURE_DEVOPS_EXT_PAT`.

Configuración disponible:

```dotenv
AZURE_DEVOPS_EXT_PAT=
RCC_TAG_PREFIX=develop_v
RCC_INTEGRATION_BRANCH=develop
```

Nunca confirmes `.env.local` en Git ni compartas su contenido. La aplicación no envía el PAT al navegador, no lo agrega a URLs y no lo registra en logs.

## Ejecución

```bash
npm run dev
```

Abre [http://127.0.0.1:3000](http://127.0.0.1:3000). El servidor queda limitado a la interfaz loopback del equipo.

Para probar una compilación de producción local:

```bash
npm run build
npm start
```

## Generar un RCC

1. Selecciona un proyecto accesible para tu usuario.
2. Selecciona un repositorio.
3. Elige uno de estos modos:
   - **RCC incremental:** selecciona la entrega anterior y la entrega final.
   - **Primer RCC:** selecciona un único tag; todos los archivos versionados se generan con acción `A`.
4. Pulsa **Consultar cambios**.
5. Usa **Copiar para Excel** o **Descargar TXT**.

El TXT y el contenido copiado tienen las mismas columnas tabuladas:

```text
Ruta    Ruta anterior    Acción    Último tag
```

Acciones:

- `A`: agregado.
- `M`: modificado o renombrado.
- `D`: eliminado.

Los renombrados muestran también la ruta anterior. Git los detecta por similitud.

## Reglas de comparación

- El tag inicial representa lo ya entregado y queda excluido.
- El tag final queda incluido.
- Los tags se ordenan por el historial first-parent de `develop`, no por nombre o fecha.
- Cada ruta aparece una sola vez con el último tag donde cambió.
- La acción se calcula comparando los extremos del rango.
- Los cambios revertidos por completo no aparecen.
- Tags ambiguos sobre un mismo commit, rangos invertidos e historias incompatibles se rechazan.
- Los tags son referencias del proceso actual; su existencia no confirma que el despliegue haya terminado correctamente.

## Copias locales

La aplicación mantiene clones Git bare en:

```text
.data/repositories/<repositoryId>.git
```

Estas copias no contienen carpeta de trabajo y no modifican los repositorios donde desarrollas. `.data/` está excluida de Git.

## Errores frecuentes

- **PAT no configurado:** revisa `AZURE_DEVOPS_EXT_PAT` en `.env.local` y reinicia la aplicación.
- **PAT rechazado o sin permisos:** confirma que no expiró y que permite leer proyectos y código.
- **Azure CLI no disponible:** instala Azure CLI y la extensión `azure-devops`.
- **Git no disponible:** instala Git y confirma que `git --version` funciona.
- **Tag no visible:** confirma el prefijo `RCC_TAG_PREFIX` y que el tag pertenece al historial first-parent de `develop`.
- **Tags ambiguos:** elimina la ambigüedad del proceso de tags; la aplicación no selecciona uno arbitrariamente.

## Verificación

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Las pruebas crean repositorios Git sintéticos temporales y no necesitan credenciales. La validación contra Azure DevOps real solo ocurre cuando configuras el PAT localmente; los datos sintéticos nunca se presentan como resultados reales.
