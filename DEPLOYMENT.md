# Despliegue en Dokploy

## Requisitos

- El registro DNS `A` de `rcc.julcesar.xyz` apunta a la IP pública del servidor.
- Los puertos 80 y 443 del servidor están disponibles para Traefik de Dokploy.

## Aplicación

1. Crea una aplicación en Dokploy y conecta este repositorio.
2. Selecciona **Dockerfile** como tipo de compilación.
3. Usa `Dockerfile` como ruta y `.` como contexto.
4. Configura estas variables de entorno en Dokploy:

   ```dotenv
   AZURE_DEVOPS_EXT_PAT=<pat-de-lectura>
   RCC_TAG_PREFIX=develop_v
   RCC_INTEGRATION_BRANCH=develop
   ```

5. En **Domains**, agrega:
   - Host: `rcc.julcesar.xyz`
   - Container Port: `3000`
   - HTTPS: activado
   - Certificate: Let's Encrypt
6. Despliega la aplicación.

No publiques el puerto 3000 en la configuración avanzada: Traefik accede al puerto interno del contenedor.

## Persistencia

Los clones bare son una caché regenerable. Para conservarlos entre despliegues, agrega un volumen persistente con destino:

```text
/app/.data
```

Sin este volumen, la aplicación sigue funcionando, pero deberá clonar de nuevo los repositorios después de cada reemplazo del contenedor.

## Actualización

Despliega nuevamente desde Dokploy después de publicar cambios en la rama configurada. Comprueba que el contenedor esté saludable y abre:

```text
https://rcc.julcesar.xyz
```
