# GAS LP SOLUCIONES

Aplicación web móvil para administrar clientes, agenda de instalaciones, catálogo, inventario y borradores de facturación electrónica de GAS LP SOLUCIONES en Costa Rica.

## Funciones

- Panel diario optimizado para teléfonos.
- Agenda de instalaciones y entregas.
- Directorio de clientes con los tipos de identificación definidos por el Ministerio de Hacienda de Costa Rica.
- Catálogo de cilindros, repuestos y servicios.
- Inventario con alertas de existencias bajas.
- Borradores de comprobantes para compartir o imprimir.
- Moneda predeterminada en colones costarricenses (CRC).
- Preparación para generar, firmar y enviar comprobantes electrónicos versión 4.4 al Ministerio de Hacienda.

## Desarrollo

Requiere Node.js 22 o posterior y una base de datos Postgres compatible con Neon.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Configura `DATABASE_URL` en `.env.local`. Para verificar la versión de producción:

```bash
npm run build
```

## Publicación

El proyecto está preparado para Next.js en Vercel. La integración de Neon proporciona `DATABASE_URL` automáticamente en los ambientes conectados.

> Los documentos creados por la app permanecen como borradores internos hasta implementar el XML 4.4, la firma digital y el envío al API de comprobantes electrónicos del Ministerio de Hacienda.
