# GAS LP SOLUCIONES

Aplicación web móvil para administrar clientes, agenda de instalaciones, catálogo, inventario y borradores de facturación FEL de GAS LP SOLUCIONES.

## Funciones

- Panel diario optimizado para teléfonos.
- Agenda de instalaciones y entregas.
- Directorio de clientes con NIT y datos de contacto.
- Catálogo de cilindros, repuestos y servicios.
- Inventario con alertas de existencias bajas.
- Borradores de comprobantes para compartir o imprimir.
- Preparación para conectar un certificador FEL autorizado.

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

> Los documentos creados por la app permanecen como borradores hasta integrar y validar las credenciales del certificador FEL del negocio.
