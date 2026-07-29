# GAS LP SOLUCIONES

Aplicación web móvil para administrar clientes, agenda de instalaciones, catálogo, inventario y borradores de facturación electrónica de GAS LP SOLUCIONES en Costa Rica.

## Funciones

- Panel diario optimizado para teléfonos.
- Agenda de instalaciones y entregas.
- Agenda condicional por tipo de trabajo y cilindros disponibles en inventario.
- Directorio de clientes con los tipos de identificación definidos por el Ministerio de Hacienda de Costa Rica.
- Catálogo de cilindros, repuestos y servicios.
- Inventario con alertas de existencias bajas.
- Documentos comerciales libres, separados de los comprobantes tributarios.
- Moneda predeterminada en colones costarricenses (CRC).
- Generación de Factura Electrónica, Tiquete Electrónico y Nota de Crédito v4.4 con actividad económica, CABYS e IVA.
- Firma XAdES-EPES, envío al API de Hacienda y consulta del estado.
- PDF fiscal con QR, XML firmado, respuesta de Hacienda y respaldo fiscal completo en ZIP.
- Configuración persistente del negocio, obligado tributario y asociado autorizado.

## Seguridad

- La aplicación abre directamente, sin clave de acceso: el despliegue debe mantenerse en un entorno privado o restringido por la plataforma.
- Las credenciales del API, el PIN y el certificado `.p12` se cifran con AES-256-GCM.
- Pruebas y producción usan perfiles de credenciales y consecutivos físicamente separados.
- Los secretos se cargan únicamente desde `Ajustes > Hacienda y facturación` y nunca se devuelven al navegador.

## Activación de Hacienda

Antes de emitir en producción se deben completar y confirmar dentro de la aplicación:

1. Método de facturación actualizado en TRIBU-CR como desarrollo propio/interno.
2. Último consecutivo utilizado de FE, TE y NC para la sucursal y terminal configuradas.
3. Usuario y contraseña **de producción** del API de comprobantes.
4. Certificado `.p12` **de producción** y su PIN.
5. Confirmación explícita de que los siguientes comprobantes serán reales.

La primera validación debe realizarse en `Pruebas (sandbox)`. Las credenciales cuyo usuario contiene `@stag` son rechazadas por el formulario de producción. Un documento comercial nunca se envía a Hacienda; un borrador electrónico no tiene validez hasta que Hacienda muestre el estado `aceptado`.

## Desarrollo

Requiere Node.js 22 o posterior y una base de datos Postgres compatible con Neon.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Configura `DATABASE_URL` y `HACIENDA_ENCRYPTION_KEY` en `.env.local`. Para verificar la versión de producción:

```bash
npm run build
```

## Publicación

El proyecto está preparado para Next.js en Vercel. La integración de Neon proporciona `DATABASE_URL` automáticamente en los ambientes conectados.
