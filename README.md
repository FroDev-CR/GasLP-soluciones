# GAS LP SOLUCIONES

Aplicación web móvil para administrar clientes, agenda de instalaciones, catálogo, inventario y borradores de facturación electrónica de GAS LP SOLUCIONES en Costa Rica.

## Funciones

- Panel diario optimizado para teléfonos.
- Agenda de instalaciones y entregas.
- Agenda condicional por tipo de trabajo y cilindros disponibles en inventario.
- Directorio de clientes con los tipos de identificación definidos por el Ministerio de Hacienda de Costa Rica.
- Catálogo de cilindros, repuestos y servicios.
- Inventario con alertas de existencias bajas.
- Borradores de comprobantes para compartir o imprimir.
- Moneda predeterminada en colones costarricenses (CRC).
- Generación de Factura Electrónica v4.4 con actividad económica, CABYS e IVA.
- Firma XAdES-EPES, envío al API de Hacienda y consulta del estado.
- Configuración persistente del negocio, obligado tributario y asociado autorizado.

## Seguridad

- La aplicación exige una clave de acceso antes de mostrar información.
- Las credenciales del API, el PIN y el certificado `.p12` se cifran con AES-256-GCM.
- Los secretos se cargan únicamente desde `Ajustes > Hacienda y facturación` y nunca se devuelven al navegador.

## Activación de Hacienda

Antes de emitir en producción se deben completar y confirmar dentro de la aplicación:

1. Método de facturación actualizado en TRIBU-CR como desarrollo propio/interno.
2. Último consecutivo utilizado en el sistema anterior.
3. Usuario y contraseña del API de comprobantes.
4. Certificado `.p12` y su PIN.

La primera validación debe realizarse en `Pruebas (sandbox)`. Un borrador o PDF comercial no es un comprobante aceptado hasta que Hacienda muestre el estado `aceptado`.

## Desarrollo

Requiere Node.js 22 o posterior y una base de datos Postgres compatible con Neon.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Configura `DATABASE_URL`, `APP_ACCESS_PASSWORD`, `SESSION_SECRET` y `HACIENDA_ENCRYPTION_KEY` en `.env.local`. Para verificar la versión de producción:

```bash
npm run build
```

## Publicación

El proyecto está preparado para Next.js en Vercel. La integración de Neon proporciona `DATABASE_URL` automáticamente en los ambientes conectados.
